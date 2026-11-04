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
import { setup } from "./setup";

/** A task with one run in `status`, written directly as the worker would leave it. */
async function withRun(
  s: Awaited<ReturnType<typeof setup>>,
  status: string,
  extra: Partial<typeof agentRuns.$inferInsert> = {},
) {
  const task = await s.mkTask();
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
  expect(out?.undo.record).toBeNull();
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
    maxParallel: 3,
    maxRunningMinutes: 240,
    maxCostUsd: 10,
    instructions: "",
    timeZone: "UTC",
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

test("retry undo after the run was claimed conflicts", async () => {
  const s = await setup();
  const failure = await s.file("Needs you: Fix the build", { source: "agent" });
  const { task, run } = await withRun(s, "failed", {
    finishedAt: new Date(),
    pending: { requestId: failure.id, seq: 0, kind: "failure" },
  });
  const out = await s.caller.agent.retry({ id: task.id });
  await s.deps.db
    .update(agentRuns)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(agentRuns.id, run.id));
  await expect(
    s.caller.ops.undo({ id: "agent.retry", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  const [after] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run.id));
  expect(after?.status).toBe("running");
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
