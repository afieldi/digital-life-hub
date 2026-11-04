import { mintRunToken } from "@dlh/server";
import { testServer } from "@dlh/server/testing";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { requests } from "../../requests/src/db/schema";
import requestsServer from "../../requests/src/server";
import tasksServer from "../../tasks/src/server";
import { agentRunEvents, agentRunMessages, agentRuns } from "../src/db/schema";
import agentServer from "../src/server";
import { setup } from "./setup";

type S = Awaited<ReturnType<typeof setup>>;

/** The test clock (`testDeps`' frozen now). */
const NOW = new Date("2026-10-30T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

/** A caller signed in as the host's worker, on its own connection. */
function worker(s: S) {
  return testServer(s.db, [tasksServer, requestsServer, agentServer], {
    principal: { kind: "worker", tokenId: "w" },
  }).caller;
}

/** A task of the agent's with one run in `status`, made `ageMinutes` ago. */
async function withRun(
  s: S,
  status: string,
  opts: {
    title?: string;
    ageMinutes?: number;
    due?: { date: string } | { dateTime: string };
    run?: Partial<typeof agentRuns.$inferInsert>;
  } = {},
) {
  const task = (
    await s.caller.tasks.create({
      title: opts.title ?? "Fix the build",
      ...(opts.due ? { due: opts.due } : {}),
    })
  ).result;
  await s.deps.db.execute(
    sql`update tasks set assignee = 'agent' where item_id = ${task.id}`,
  );
  const [run] = await s.deps.db
    .insert(agentRuns)
    .values({
      taskId: task.id,
      status,
      createdAt: minutesAgo(opts.ageMinutes ?? 10),
      ...(status === "running" ? { heartbeatAt: NOW, startedAt: NOW } : {}),
      ...opts.run,
    })
    .returning();
  if (!run) throw new Error("no run");
  return { task, run };
}

/** The claim's result when it handed over a run. */
async function claimed(s: S) {
  const { result } = await worker(s).agent.claim({});
  if (result.run === null) throw new Error("nothing claimed");
  return result;
}

async function runById(s: S, id: string) {
  const [row] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, id));
  return row;
}

async function liveTokens(s: S, runId: string) {
  const rows = await s.deps.db.execute<{ n: number }>(
    sql`select count(*)::int as n from service_tokens where run_id = ${runId} and revoked_at is null`,
  );
  return rows[0]?.n;
}

test("claim takes the oldest queued run", async () => {
  const s = await setup();
  await withRun(s, "queued", { title: "Newer", ageMinutes: 5 });
  const old = await withRun(s, "queued", { title: "Older", ageMinutes: 20 });
  const out = await worker(s).agent.claim({});
  const claimed = out.result;
  if (!claimed.run) throw new Error("nothing claimed");
  expect(claimed.run).toMatchObject({
    id: old.run.id,
    status: "running",
    startedAt: NOW.toISOString(),
    heartbeatAt: NOW.toISOString(),
  });
  expect(claimed.task).toEqual({
    id: old.task.id,
    title: "Older",
    notes: null,
  });
  expect(claimed.token).toEqual(expect.any(String));
  expect(claimed.request).toBeNull();
  expect(await liveTokens(s, old.run.id)).toBe(1);
  await s.close();
});

test("claim keeps a run's first start", async () => {
  const s = await setup();
  const first = minutesAgo(60);
  const { run } = await withRun(s, "queued", {
    run: { startedAt: first, heartbeatAt: minutesAgo(30) },
  });
  const out = await worker(s).agent.claim({});
  expect(out.result.run).toMatchObject({
    id: run.id,
    startedAt: first.toISOString(),
    heartbeatAt: NOW.toISOString(),
  });
  await s.close();
});

test("claim respects the parallel limit", async () => {
  const s = await setup();
  await s.caller.agent.setSettings({ maxParallel: 2 });
  await withRun(s, "running");
  await withRun(s, "running");
  const queued = await withRun(s, "queued");
  const out = await worker(s).agent.claim({});
  expect(out.result).toEqual({ run: null });
  expect((await runById(s, queued.run.id))?.status).toBe("queued");
  await s.close();
});

test("claim with nothing queued returns no run", async () => {
  const s = await setup();
  expect((await worker(s).agent.claim({})).result).toEqual({ run: null });
  await s.close();
});

test("claim skips a task due later and takes the next", async () => {
  const s = await setup();
  const later = await withRun(s, "queued", {
    title: "Later",
    ageMinutes: 30,
    due: { dateTime: "2026-10-30T13:00:00Z" },
  });
  const tomorrow = await withRun(s, "queued", {
    title: "Tomorrow",
    ageMinutes: 25,
    due: { date: "2026-10-31" },
  });
  const today = await withRun(s, "queued", {
    title: "Today",
    ageMinutes: 5,
    due: { date: "2026-10-30" },
  });
  const out = await worker(s).agent.claim({});
  expect(out.result.run?.id).toBe(today.run.id);
  expect((await runById(s, later.run.id))?.status).toBe("queued");
  expect((await runById(s, tomorrow.run.id))?.status).toBe("queued");
  await s.close();
});

test("an all-day due is read in the settings time zone", async () => {
  const s = await setup();
  // 12:00 UTC on the 30th is already the 31st in Kiritimati (UTC+14).
  await s.caller.agent.setSettings({ timeZone: "Pacific/Kiritimati" });
  const { run } = await withRun(s, "queued", { due: { date: "2026-10-31" } });
  expect((await worker(s).agent.claim({})).result.run?.id).toBe(run.id);
  await s.close();
});

test("claim cancels a run whose task was completed", async () => {
  const s = await setup();
  const done = await withRun(s, "queued", { title: "Done", ageMinutes: 30 });
  const next = await withRun(s, "queued", { title: "Next", ageMinutes: 5 });
  await s.caller.tasks.complete({
    id: done.task.id,
    expectedUpdatedAt: done.task.updatedAt,
  });
  const out = await worker(s).agent.claim({});
  expect(out.result.run?.id).toBe(next.run.id);
  expect(await runById(s, done.run.id)).toMatchObject({
    status: "cancelled",
    finishedAt: NOW,
  });
  await s.close();
});

test("claim cancels a run whose task was deleted or taken back", async () => {
  const s = await setup();
  const gone = await withRun(s, "queued", { title: "Gone" });
  const mine = await withRun(s, "queued", { title: "Mine" });
  await s.deps.db.execute(
    sql`update items set deleted_at = now() where id = ${gone.task.id}`,
  );
  await s.deps.db.execute(
    sql`update tasks set assignee = 'me' where item_id = ${mine.task.id}`,
  );
  expect((await worker(s).agent.claim({})).result).toEqual({ run: null });
  expect((await runById(s, gone.run.id))?.status).toBe("cancelled");
  expect((await runById(s, mine.run.id))?.status).toBe("cancelled");
  await s.close();
});

test("claim cancels a waiting run whose task was completed, and resolves its approval", async () => {
  const s = await setup();
  const approval = await s.file("Approve: deploy", { source: "agent" });
  const { task, run } = await withRun(s, "waiting", {
    run: { pending: { requestId: approval.id, seq: 3, kind: "approval" } },
  });
  await s.deps.db.transaction((tx) => mintRunToken(tx, run.id));
  await s.caller.tasks.complete({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  expect((await worker(s).agent.claim({})).result).toEqual({ run: null });
  expect(await runById(s, run.id)).toMatchObject({
    status: "cancelled",
    pending: null,
  });
  expect(await liveTokens(s, run.id)).toBe(0);
  const [req] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, approval.id));
  expect(req?.outcome).toBe("handled");
  await s.close();
});

test("a missed heartbeat returns the run to queued and revokes its token", async () => {
  const s = await setup();
  await s.caller.agent.setSettings({ maxParallel: 1 });
  const stale = await withRun(s, "running", {
    run: { heartbeatAt: minutesAgo(3) },
  });
  const fresh = await withRun(s, "running", {
    run: { heartbeatAt: minutesAgo(1) },
  });
  await s.deps.db.transaction(async (tx) => {
    await mintRunToken(tx, stale.run.id);
    await mintRunToken(tx, fresh.run.id);
  });
  const before = stale.task.updatedAt;
  // The fresh run holds the one slot, so the swept run stays queued.
  expect((await worker(s).agent.claim({})).result).toEqual({ run: null });
  expect((await runById(s, stale.run.id))?.status).toBe("queued");
  expect((await runById(s, fresh.run.id))?.status).toBe("running");
  expect(await liveTokens(s, stale.run.id)).toBe(0);
  expect(await liveTokens(s, fresh.run.id)).toBe(1);
  const task = await s.caller.tasks.get({ id: stale.task.id });
  expect(task.task.updatedAt).not.toBe(before);
  await s.close();
});

test("concurrent claims never exceed the parallel limit", async () => {
  const s = await setup();
  await s.caller.agent.setSettings({ maxParallel: 2 });
  await withRun(s, "running");
  await withRun(s, "queued", { ageMinutes: 20 });
  await withRun(s, "queued", { ageMinutes: 10 });
  const [a, b] = await Promise.all([
    worker(s).agent.claim({}),
    worker(s).agent.claim({}),
  ]);
  const claimed = [a, b].filter((o) => o.result.run !== null);
  expect(claimed).toHaveLength(1);
  const running = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.status, "running"));
  expect(running).toHaveLength(2);
  await s.close();
});

test("two workers claiming at once get different runs", async () => {
  const s = await setup();
  await s.caller.agent.setSettings({ maxParallel: 2 });
  const one = await withRun(s, "queued", { ageMinutes: 20 });
  const two = await withRun(s, "queued", { ageMinutes: 10 });
  const [a, b] = await Promise.all([
    worker(s).agent.claim({}),
    worker(s).agent.claim({}),
  ]);
  expect([a.result.run?.id, b.result.run?.id].sort()).toEqual(
    [one.run.id, two.run.id].sort(),
  );
  await s.close();
});

test("claim returns the request body for a task given from a request", async () => {
  const s = await setup();
  const r = await s.file("Update the deps", {
    body: "All of them",
    fromName: "Ana",
  });
  const given = await s.caller.agent.assignRequest({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  const out = await claimed(s);
  expect(out.run.id).toBe(given.result.run.id);
  expect(out.request).toEqual({ sender: "Ana", body: "All of them" });
  await s.close();
});

test("claim returns no request when the task's request is gone", async () => {
  const s = await setup();
  const r = await s.file("Update the deps", { body: "All of them" });
  await s.caller.agent.assignRequest({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  await s.deps.db.execute(
    sql`update items set deleted_at = now() where id = ${r.id}`,
  );
  expect((await claimed(s)).request).toBeNull();
  await s.close();
});

test("claim delivers a pending decision once", async () => {
  const s = await setup();
  const { run } = await withRun(s, "queued", {
    run: {
      sessionId: "sess-1",
      decision: { seq: 4, approve: true, delivered: false },
    },
  });
  const first = await claimed(s);
  expect(first).toMatchObject({
    sessionId: "sess-1",
    decision: { seq: 4, approve: true, delivered: true },
  });
  expect((await runById(s, run.id))?.decision).toEqual({
    seq: 4,
    approve: true,
    delivered: true,
  });
  // Back in the queue (e.g. a missed heartbeat): the decision isn't sent again.
  await s.deps.db
    .update(agentRuns)
    .set({ status: "queued" })
    .where(eq(agentRuns.id, run.id));
  const second = await claimed(s);
  expect(second.run.id).toBe(run.id);
  expect(second.decision).toBeNull();
  await s.close();
});

test("claim hands over undelivered messages once", async () => {
  const s = await setup();
  const { run } = await withRun(s, "queued");
  await s.deps.db.insert(agentRunMessages).values([
    { runId: run.id, body: "Use pnpm", at: minutesAgo(2) },
    { runId: run.id, body: "Old", at: minutesAgo(9), deliveredAt: NOW },
    { runId: run.id, body: "And bump vite", at: minutesAgo(1) },
  ]);
  const first = await claimed(s);
  expect(first.messages.map((m) => m.body)).toEqual([
    "Use pnpm",
    "And bump vite",
  ]);
  await s.deps.db
    .update(agentRuns)
    .set({ status: "queued" })
    .where(eq(agentRuns.id, run.id));
  expect((await claimed(s)).messages).toEqual([]);
  await s.close();
});

test("events of runs ended over 30 days ago are removed", async () => {
  const s = await setup();
  const old = await withRun(s, "done", { run: { finishedAt: daysAgo(31) } });
  const recent = await withRun(s, "done", {
    run: { finishedAt: daysAgo(29) },
  });
  const event = (runId: string) => ({
    runId,
    seq: 1,
    kind: "text",
    data: { text: "hi" },
  });
  await s.deps.db
    .insert(agentRunEvents)
    .values([event(old.run.id), event(recent.run.id)]);
  await worker(s).agent.claim({});
  const left = await s.deps.db.select().from(agentRunEvents);
  expect(left.map((e) => e.runId)).toEqual([recent.run.id]);
  await s.close();
});

test("claim is for the worker only", async () => {
  const s = await setup();
  await expect(s.caller.agent.claim({})).rejects.toMatchObject({
    code: "FORBIDDEN",
  });
  await s.close();
});
