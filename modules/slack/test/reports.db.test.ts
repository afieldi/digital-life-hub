import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { agentAssignments, agentRuns } from "../../agent/src/db/schema";
import { setup } from "./setup";

const report = {
  summary: "Fixed the build.",
  links: [
    { label: "PR", url: "https://example.com/pr/1" },
    { label: "Log", url: "https://example.com/log" },
  ],
  filesChanged: ["a.ts"],
};

type S = Awaited<ReturnType<typeof setup>>;

/** A run that ended at `finishedAt` for a task made from a request filed with `request` (none: no request). */
async function endedRun(
  s: S,
  o: {
    title?: string;
    status?: "done" | "failed";
    finishedAt: Date;
    request?: Record<string, unknown>;
  },
) {
  const task = await s.caller.tasks.create({ title: o.title ?? "Fix it" });
  const [run] = await s.deps.db
    .insert(agentRuns)
    .values({
      taskId: task.result.id,
      status: o.status ?? "done",
      finishedAt: o.finishedAt,
      report: o.status === "failed" ? null : report,
      failureMessage: o.status === "failed" ? "It crashed" : null,
    })
    .returning();
  if (!run) throw new Error("no run");
  if (o.request) {
    const filed = await s.caller.requests.file({
      title: "From Slack",
      source: "slack",
      ...o.request,
    } as never);
    await s.deps.db.insert(agentAssignments).values({
      taskId: task.result.id,
      requestId: filed.result.request.id,
    });
  }
  return run;
}

const dm = {
  fromOwner: true,
  externalId: "D1:1700000000.000001",
  sourceUrl: "https://example.slack.com/archives/D1/p1700000000000001",
};

const outbox = (s: S) =>
  s.db.execute<{
    key: string;
    origin: string;
    status: string;
    channel_id: string;
    thread_ts: string | null;
    text: string;
    run_id: string | null;
  }>(
    sql`select key, origin, status, channel_id, thread_ts, text, run_id from slack_outbox order by key`,
  );

const syncedAt = async (s: S) => {
  const at = (
    await s.db.execute<{ at: string | null }>(
      sql`select runs_synced_at::text as at from slack_settings`,
    )
  )[0]?.at;
  return at ? new Date(at) : null;
};

/** Starts the clock at `at`, as the first syncRuns would, a little earlier than the runs. */
async function started(s: S, at: Date) {
  await s.db.execute(
    sql`update slack_settings set runs_synced_at = ${at.toISOString()}::timestamptz`,
  );
}

const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 12, m));

test("syncRuns reports a run from your DM once", async () => {
  const s = await setup();
  await started(s, t(0));
  const run = await endedRun(s, {
    title: "Fix the build",
    finishedAt: t(10),
    request: dm,
  });
  await s.slack.slack.syncRuns({});
  await s.slack.slack.syncRuns({});
  const rows = await outbox(s);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    key: `report:${run.id}`,
    origin: "report",
    status: "approved",
    channel_id: "D1",
    thread_ts: "1700000000.000001",
    run_id: run.id,
    text: "Done: Fix the build\nFixed the build.\nPR: https://example.com/pr/1\nLog: https://example.com/log",
  });
  expect((await syncedAt(s))?.toISOString()).toBe(t(10).toISOString());
  await s.close();
});

test("a report goes to the thread the message was in", async () => {
  const s = await setup();
  await started(s, t(0));
  await endedRun(s, {
    finishedAt: t(10),
    request: {
      ...dm,
      externalId: "C9:1700000009.000001",
      sourceUrl:
        "https://example.slack.com/archives/C9/p1700000009000001?thread_ts=1700000005.000001&cid=C9",
    },
  });
  await s.slack.slack.syncRuns({});
  expect((await outbox(s))[0]).toMatchObject({
    channel_id: "C9",
    thread_ts: "1700000005.000001",
  });
  await s.close();
});

test("syncRuns skips a coworker's run and a run with no request", async () => {
  const s = await setup();
  await started(s, t(0));
  await endedRun(s, {
    finishedAt: t(10),
    request: { ...dm, fromOwner: false },
  });
  await endedRun(s, { finishedAt: t(20) });
  await endedRun(s, {
    finishedAt: t(30),
    request: { fromOwner: true, source: "manual" },
  });
  await s.slack.slack.syncRuns({});
  expect(await outbox(s)).toHaveLength(0);
  // Skipped runs are still behind the clock.
  expect((await syncedAt(s))?.toISOString()).toBe(t(30).toISOString());
  await s.close();
});

test("a failed run reports its failure", async () => {
  const s = await setup();
  await started(s, t(0));
  await endedRun(s, {
    title: "Fix the build",
    status: "failed",
    finishedAt: t(10),
    request: dm,
  });
  await s.slack.slack.syncRuns({});
  expect((await outbox(s))[0]?.text).toBe(
    "The agent couldn't finish Fix the build: It crashed",
  );
  await s.close();
});

test("the first syncRuns only starts the clock", async () => {
  const s = await setup();
  await endedRun(s, { finishedAt: t(10), request: dm });
  expect(await syncedAt(s)).toBeNull();
  await s.slack.slack.syncRuns({});
  expect(await outbox(s)).toHaveLength(0);
  expect((await syncedAt(s))?.getTime()).toBeGreaterThan(t(10).getTime());
  await s.close();
});
