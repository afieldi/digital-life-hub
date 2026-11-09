import { mintRunToken } from "@dlh/server";
import { expectTracked } from "@dlh/server/testing";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { requests } from "../../requests/src/db/schema";
import {
  agentConnections,
  agentRunEvents,
  agentRunMessages,
  agentRuns,
} from "../src/db/schema";
import { ALREADY_LIVE, holdingSlot } from "../src/server/runs";
import { setup, version } from "./setup";

/** A task with one run in `status`, written directly as the worker would leave it. */
async function withRun(
  s: Awaited<ReturnType<typeof setup>>,
  status: string,
  extra: Partial<typeof agentRuns.$inferInsert> = {},
) {
  const task = await s.mkTask();
  // As assign leaves it: the task is the agent's.
  await s.deps.db.execute(
    sql`update tasks set assignee = 'agent' where item_id = ${task.id}`,
  );
  const [run] = await s.deps.db
    .insert(agentRuns)
    .values({ taskId: task.id, status, ...extra })
    .returning();
  if (!run) throw new Error("no run");
  return { task, run };
}

test("retry of a failed run requeues it and resolves its failure request", async () => {
  const s = await setup();
  const failure = await s.file("Needs you: Fix the build", { source: "agent" });
  const { task, run } = await withRun(s, "failed", {
    finishedAt: new Date(),
    failureCode: "crash",
    failureMessage: "It crashed",
    failures: 1,
    pending: { requestId: failure.id, seq: 0, kind: "failure" },
  });
  await expectTracked(s.deps, { itemId: task.id }, () =>
    s.caller.agent.retry({ id: task.id }),
  );
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after).toMatchObject({
    status: "queued",
    pending: null,
    finishedAt: null,
    failures: 1,
  });
  const [req] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, failure.id));
  expect(req?.outcome).toBe("handled");
  await s.close();
});

test("retry acts on the task's latest run", async () => {
  const s = await setup();
  const { task } = await withRun(s, "done", {
    createdAt: new Date("2026-11-01T00:00:00Z"),
  });
  const [latest] = await s.deps.db
    .insert(agentRuns)
    .values({ taskId: task.id, status: "cancelled" })
    .returning();
  const out = await s.caller.agent.retry({ id: task.id });
  expect(out.result).toMatchObject({ id: latest?.id, status: "queued" });
  expect(out.undo.record).toMatchObject({
    runId: latest?.id,
    status: "cancelled",
  });
  await s.close();
});

test("retry of a running run is CONFLICT", async () => {
  const s = await setup();
  const { task, run } = await withRun(s, "running");
  await expect(s.caller.agent.retry({ id: task.id })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after?.status).toBe("running");
  await s.close();
});

test("cancel stops the latest run, revokes its tokens and touches the task", async () => {
  const s = await setup();
  const { task, run } = await withRun(s, "running");
  await s.deps.db.transaction((tx) => mintRunToken(tx, run.id));
  let out: Awaited<ReturnType<typeof s.caller.agent.cancel>> | undefined;
  await expectTracked(s.deps, { itemId: task.id }, async () => {
    out = await s.caller.agent.cancel({ id: task.id });
  });
  expect(out?.result).toMatchObject({ id: run.id, status: "cancelled" });
  expect(out?.result.finishedAt).not.toBeNull();
  expect(out?.undo.record).toMatchObject({ runId: run.id, status: "running" });
  const live = await s.deps.db.execute(
    sql`select 1 from service_tokens where run_id = ${run.id} and revoked_at is null`,
  );
  expect(live).toHaveLength(0);
  await s.close();
});

test("cancel of a done run is CONFLICT", async () => {
  const s = await setup();
  const { task } = await withRun(s, "done");
  await expect(s.caller.agent.cancel({ id: task.id })).rejects.toMatchObject({
    code: "CONFLICT",
    message: "This run has ended",
  });
  await s.close();
});

test('message to a done run is "This run has ended"', async () => {
  const s = await setup();
  const { run } = await withRun(s, "done");
  await expect(
    s.caller.agent.message({ runId: run.id, body: "Also do X" }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "This run has ended",
  });
  await s.close();
});

test("message to a waiting run is stored for delivery", async () => {
  const s = await setup();
  const { run } = await withRun(s, "waiting");
  await s.caller.agent.message({ runId: run.id, body: "Also do X" });
  const rows = await s.deps.db
    .select()
    .from(agentRunMessages)
    .where(eq(agentRunMessages.runId, run.id));
  expect(rows).toMatchObject([{ body: "Also do X", deliveredAt: null }]);
  await s.close();
});

test("events returns at most 500 after seq", async () => {
  const s = await setup();
  const { run } = await withRun(s, "running");
  await s.deps.db.insert(agentRunEvents).values(
    Array.from({ length: 600 }, (_, i) => ({
      runId: run.id,
      seq: i + 1,
      kind: "text",
      data: { text: `line ${i + 1}` },
    })),
  );
  const { events } = await s.caller.agent.events({ runId: run.id, after: 10 });
  expect(events).toHaveLength(500);
  expect(events[0]).toMatchObject({ seq: 11, kind: "text" });
  expect(events[499]?.seq).toBe(510);
  const tail = await s.caller.agent.events({ runId: run.id, after: 590 });
  expect(tail.events.map((e) => e.seq)).toEqual([
    591, 592, 593, 594, 595, 596, 597, 598, 599, 600,
  ]);
  await s.close();
});

test("run and runs return parsed rows, newest first", async () => {
  const s = await setup();
  const { task, run } = await withRun(s, "done", {
    createdAt: new Date("2026-11-01T00:00:00Z"),
    costUsd: "1.2345",
  });
  const [next] = await s.deps.db
    .insert(agentRuns)
    .values({ taskId: task.id, status: "queued" })
    .returning();
  expect(await s.caller.agent.run({ runId: run.id })).toMatchObject({
    id: run.id,
    costUsd: 1.2345,
    createdAt: "2026-11-01T00:00:00.000Z",
  });
  const { runs } = await s.caller.agent.runs({ taskId: task.id });
  expect(runs.map((r) => r.id)).toEqual([next?.id, run.id]);
  const queued = await s.caller.agent.runs({ status: "queued" });
  expect(queued.runs.map((r) => r.id)).toEqual([next?.id]);
  await s.close();
});

test("connections lists live ones first, then disabled; disabling marks it", async () => {
  const s = await setup();
  const [a, b] = await s.deps.db
    .insert(agentConnections)
    .values([
      { name: "a-github", type: "github" },
      { name: "b-slack", type: "slack", scopeSummary: "#eng" },
    ])
    .returning();
  if (!a || !b) throw new Error("no connections");
  await s.caller.agent.setDefaultConnections({ ids: [b.id] });
  await s.caller.agent.disableConnection({ id: a.id });
  const { connections } = await s.caller.agent.connections({});
  expect(connections).toMatchObject([
    { id: b.id, name: "b-slack", isDefault: true, disabledAt: null },
    { id: a.id, name: "a-github", isDefault: false },
  ]);
  expect(connections[1]?.disabledAt).not.toBeNull();
  await s.close();
});

test("setDefaultConnections refuses an unknown connection", async () => {
  const s = await setup();
  await expect(
    s.caller.agent.setDefaultConnections({
      ids: ["0190f2a0-0000-7000-8000-000000000000"],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await s.close();
});

test("settings returns the defaults; setSettings changes only what it is given", async () => {
  const s = await setup();
  expect(await s.caller.agent.settings({})).toEqual({
    defaultConnectionIds: [],
    coworkerConnectionIds: [],
    maxParallel: 3,
    maxRunningMinutes: 240,
    maxCostUsd: 10,
    instructions: "",
    timeZone: "UTC",
    workerSeenAt: null,
  });
  const out = await s.caller.agent.setSettings({
    maxCostUsd: 2.5,
    timeZone: "Europe/Warsaw",
  });
  expect(out.result).toMatchObject({
    maxParallel: 3,
    maxCostUsd: 2.5,
    timeZone: "Europe/Warsaw",
  });
  await s.caller.ops.undo({ id: "agent.setSettings", token: out.undo });
  expect(await s.caller.agent.settings({})).toMatchObject({
    maxCostUsd: 10,
    timeZone: "UTC",
  });
  await s.close();
});

test("setSettings refuses max_parallel 0", async () => {
  const s = await setup();
  await expect(
    s.caller.agent.setSettings({ maxParallel: 0 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await s.caller.agent.settings({})).maxParallel).toBe(3);
  await s.close();
});

test("setSettings refuses a time zone that isn't one", async () => {
  const s = await setup();
  for (const timeZone of ["Mars/Olympus", "not a zone"]) {
    await expect(
      s.caller.agent.setSettings({ timeZone }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  expect((await s.caller.agent.settings({})).timeZone).toBe("UTC");
  await s.caller.agent.setSettings({ timeZone: "America/New_York" });
  expect((await s.caller.agent.settings({})).timeZone).toBe("America/New_York");
  await s.close();
});

test("setSettings refuses a cost cap under one cent", async () => {
  const s = await setup();
  for (const maxCostUsd of [0, 0.005]) {
    await expect(
      s.caller.agent.setSettings({ maxCostUsd }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  await s.caller.agent.setSettings({ maxCostUsd: 0.01 });
  expect((await s.caller.agent.settings({})).maxCostUsd).toBe(0.01);
  await s.close();
});

test("retry undo puts the run back to failed and reopens its request", async () => {
  const s = await setup();
  const failure = await s.file("Needs you: Fix the build", { source: "agent" });
  const finishedAt = new Date("2026-11-03T10:00:00.000Z");
  const { task, run } = await withRun(s, "failed", {
    finishedAt,
    failureCode: "crash",
    failureMessage: "It crashed",
    failures: 1,
    pending: { requestId: failure.id, seq: 0, kind: "failure" },
  });
  const out = await s.caller.agent.retry({ id: task.id });
  await expectTracked(s.deps, { itemId: task.id }, () =>
    s.caller.ops.undo({ id: "agent.retry", token: out.undo }),
  );
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after).toMatchObject({
    status: "failed",
    finishedAt,
    failureCode: "crash",
    failureMessage: "It crashed",
    failures: 1,
    pending: { requestId: failure.id, seq: 0, kind: "failure" },
  });
  const [req] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, failure.id));
  expect(req?.outcome).toBeNull();
  await s.close();
});

test("retry undo after the run was claimed and requeued conflicts", async () => {
  const s = await setup();
  const failure = await s.file("Needs you: Fix the build", { source: "agent" });
  const { task, run } = await withRun(s, "failed", {
    finishedAt: new Date(),
    pending: { requestId: failure.id, seq: 0, kind: "failure" },
  });
  const out = await s.caller.agent.retry({ id: task.id });
  await s.deps.db
    .update(agentRuns)
    // Claimed (heartbeat set), then sent back to the queue by the stale sweep.
    .set({ heartbeatAt: new Date() })
    .where(eq(agentRuns.id, run.id));
  await expect(
    s.caller.ops.undo({ id: "agent.retry", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after?.status).toBe("queued");
  const [req] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, failure.id));
  expect(req?.outcome).toBe("handled");
  await s.close();
});

test("cancel of a waiting run resolves its approval request", async () => {
  const s = await setup();
  const ask = await s.file("Merge the PR?", { source: "agent" });
  const { task, run } = await withRun(s, "waiting", {
    pending: { requestId: ask.id, seq: 7, kind: "approval" },
  });
  const out = await s.caller.agent.cancel({ id: task.id });
  expect(out.result).toMatchObject({
    id: run.id,
    status: "cancelled",
    pending: null,
  });
  const [req] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, ask.id));
  expect(req?.outcome).toBe("handled");
  await s.close();
});

test("cancel of a failed run leaves its failure request", async () => {
  const s = await setup();
  const failure = await s.file("Needs you: Fix the build", { source: "agent" });
  const { task } = await withRun(s, "failed", {
    pending: { requestId: failure.id, seq: 0, kind: "failure" },
  });
  await expect(s.caller.agent.cancel({ id: task.id })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const [req] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, failure.id));
  expect(req?.outcome).toBeNull();
  await s.close();
});

test("cancel undo restores a waiting run and reopens its request", async () => {
  const s = await setup();
  const ask = await s.file("Merge the PR?", { source: "agent" });
  const pendingAsk = { requestId: ask.id, seq: 7, kind: "approval" } as const;
  const { task, run } = await withRun(s, "waiting", { pending: pendingAsk });
  const out = await s.caller.agent.cancel({ id: task.id });
  await expectTracked(s.deps, { itemId: task.id }, () =>
    s.caller.ops.undo({ id: "agent.cancel", token: out.undo }),
  );
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after).toMatchObject({
    status: "waiting",
    pending: pendingAsk,
    finishedAt: null,
  });
  const [req] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, ask.id));
  expect(req?.outcome).toBeNull();
  await s.close();
});

test("cancel undo of a running run puts it back in the queue", async () => {
  const s = await setup();
  const { task, run } = await withRun(s, "running", {
    heartbeatAt: new Date("2026-11-04T10:00:00.000Z"),
  });
  const out = await s.caller.agent.cancel({ id: task.id });
  await s.caller.ops.undo({ id: "agent.cancel", token: out.undo });
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after).toMatchObject({ status: "queued", finishedAt: null });
  await s.close();
});

test("cancel undo after a retry conflicts", async () => {
  const s = await setup();
  const { task, run } = await withRun(s, "running");
  const out = await s.caller.agent.cancel({ id: task.id });
  await s.caller.agent.retry({ id: task.id });
  await expect(
    s.caller.ops.undo({ id: "agent.cancel", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after?.status).toBe("queued");
  await s.close();
});

test("cancel undo after the task was reassigned conflicts", async () => {
  const s = await setup();
  const { task, run } = await withRun(s, "running");
  const out = await s.caller.agent.cancel({ id: task.id });
  // Assigned again: a new run, which then fails.
  const again = await s.caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: await version(s.deps, task.id),
  });
  await s.deps.db
    .update(agentRuns)
    .set({ status: "failed" })
    .where(eq(agentRuns.id, again.result.run.id));
  await expect(
    s.caller.ops.undo({ id: "agent.cancel", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after?.status).toBe("cancelled");
  await s.close();
});

test("retry while another run is live is CONFLICT", async () => {
  const s = await setup();
  const { task } = await withRun(s, "queued", {
    createdAt: new Date("2026-11-01T00:00:00Z"),
  });
  // A later run that failed: the latest, so the one retry would requeue.
  await s.deps.db
    .insert(agentRuns)
    .values({ taskId: task.id, status: "failed" });
  await expect(s.caller.agent.retry({ id: task.id })).rejects.toMatchObject({
    code: "CONFLICT",
    message: ALREADY_LIVE,
  });
  await s.close();
});

test("retry after Back to me is CONFLICT", async () => {
  const s = await setup();
  const { task } = await withRun(s, "failed");
  await s.caller.tasks.setAssignee({
    id: task.id,
    expectedUpdatedAt: await version(s.deps, task.id),
    assignee: "me",
  });
  await expect(s.caller.agent.retry({ id: task.id })).rejects.toMatchObject({
    code: "CONFLICT",
    message: "This task is back with you",
  });
  await s.close();
});

test("a second live run for a task has the conflict copy, not a database error", async () => {
  const s = await setup();
  const { task } = await withRun(s, "queued");
  await expect(
    s.deps.db.transaction((tx) =>
      holdingSlot(() =>
        tx.insert(agentRuns).values({ taskId: task.id, status: "waiting" }),
      ),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT", message: ALREADY_LIVE });
  // Any other failure is passed on as it is.
  await expect(
    holdingSlot(() =>
      s.deps.db.insert(agentRuns).values({ taskId: task.id, status: "bogus" }),
    ),
  ).rejects.not.toMatchObject({ code: "CONFLICT" });
  await s.close();
});
