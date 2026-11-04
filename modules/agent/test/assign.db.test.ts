import { mintRunToken } from "@dlh/server";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { requests } from "../../requests/src/db/schema";
import {
  agentAssignments,
  agentConnections,
  agentRuns,
} from "../src/db/schema";
import { assigneeOf, isDeleted, runsOf, setup, version } from "./setup";

test("assign queues a run and sets the assignee", async () => {
  const { deps, caller, mkTask, close } = await setup();
  const task = await mkTask();
  const [c] = await deps.db
    .insert(agentConnections)
    .values({ name: "gh", type: "github" })
    .returning();
  const out = await caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
    connections: [c.id],
  });
  expect(out.result.run).toMatchObject({
    taskId: task.id,
    status: "queued",
    connectionIds: [c.id],
    costUsd: 0,
  });
  expect(await assigneeOf(deps, task.id)).toBe("agent");
  const [a] = await deps.db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.taskId, task.id));
  expect(a).toMatchObject({ connectionIds: [c.id], requestId: null });
  expect(await runsOf(deps, task.id)).toHaveLength(1);
  await close();
});

test("assign uses the default connections when none are given", async () => {
  const { deps, caller, mkTask, close } = await setup();
  const [c] = await deps.db
    .insert(agentConnections)
    .values({ name: "gh", type: "github" })
    .returning();
  await caller.agent.setDefaultConnections({ ids: [c.id] });
  const task = await mkTask();
  const out = await caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  expect(out.result.run.connectionIds).toEqual([c.id]);
  await close();
});

test("assign undo removes the queued run and sets the assignee back", async () => {
  const { deps, caller, mkTask, close } = await setup();
  const task = await mkTask();
  const out = await caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  await caller.ops.undo({ id: "agent.assign", token: out.undo });
  expect(await runsOf(deps, task.id)).toHaveLength(0);
  expect(await assigneeOf(deps, task.id)).toBe("me");
  const assignments = await deps.db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.taskId, task.id));
  expect(assignments).toHaveLength(0);
  await close();
});

test("assignRequest makes the task, resolves the request and queues a run in one transaction", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Update the deps", { body: "All of them" });
  const out = await caller.agent.assignRequest({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  const { task, run } = out.result;
  expect(task.title).toBe("Update the deps");
  expect(await assigneeOf(deps, task.id)).toBe("agent");
  const notes = await deps.db.execute<{ notes: string | null }>(
    sql`select notes from tasks where item_id = ${task.id}`,
  );
  expect(notes[0]?.notes).toBe("All of them");
  const [req] = await deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, r.id));
  expect(req?.outcome).toBe("task");
  expect(run).toMatchObject({ taskId: task.id, status: "queued" });
  const [a] = await deps.db
    .select()
    .from(agentAssignments)
    .where(eq(agentAssignments.taskId, task.id));
  expect(a?.requestId).toBe(r.id);
  await close();
});

test("assignRequest is all or nothing: a stale request version writes nothing", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Update the deps");
  await expect(
    caller.agent.assignRequest({
      id: r.id,
      expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await deps.db.select().from(agentRuns)).toHaveLength(0);
  const tasks = await deps.db.execute(
    sql`select 1 from items where type = 'task'`,
  );
  expect(tasks).toHaveLength(0);
  await close();
});

test("assignRequest undo deletes the task, reopens the request and removes the run", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Update the deps");
  const out = await caller.agent.assignRequest({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  await caller.ops.undo({ id: "agent.assignRequest", token: out.undo });
  expect(await isDeleted(deps, out.result.task.id)).toBe(true);
  expect(await runsOf(deps, out.result.task.id)).toHaveLength(0);
  const [req] = await deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, r.id));
  expect(req?.outcome).toBeNull();
  await close();
});

test("assignRequest undo after the run was claimed conflicts and changes nothing", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Update the deps");
  const out = await caller.agent.assignRequest({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  await deps.db
    .update(agentRuns)
    .set({ status: "running" })
    .where(eq(agentRuns.id, out.result.run.id));
  await expect(
    caller.ops.undo({ id: "agent.assignRequest", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  expect(await isDeleted(deps, out.result.task.id)).toBe(false);
  expect(await assigneeOf(deps, out.result.task.id)).toBe("agent");
  const [run] = await runsOf(deps, out.result.task.id);
  expect(run?.status).toBe("running");
  const [req] = await deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, r.id));
  expect(req?.outcome).toBe("task");
  await close();
});

test("assigning a task with an active run is CONFLICT", async () => {
  const { deps, caller, mkTask, close } = await setup();
  const task = await mkTask();
  await caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  await expect(
    caller.agent.assign({
      id: task.id,
      expectedUpdatedAt: await version(deps, task.id),
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await runsOf(deps, task.id)).toHaveLength(1);
  await close();
});

test("unassign cancels the active run", async () => {
  const { deps, caller, mkTask, close } = await setup();
  const task = await mkTask();
  const out = await caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  const runId = out.result.run.id;
  await deps.db
    .update(agentRuns)
    .set({ status: "running" })
    .where(eq(agentRuns.id, runId));
  await deps.db.transaction((tx) => mintRunToken(tx, runId));
  const back = await caller.agent.unassign({
    id: task.id,
    expectedUpdatedAt: await version(deps, task.id),
  });
  expect(back.result.run).toMatchObject({ id: runId, status: "cancelled" });
  expect(back.result.run?.finishedAt).not.toBeNull();
  expect(await assigneeOf(deps, task.id)).toBe("me");
  const live = await deps.db.execute(
    sql`select 1 from service_tokens where run_id = ${runId} and revoked_at is null`,
  );
  expect(live).toHaveLength(0);
  // Undo gives the task back to the agent; the run stays cancelled.
  await caller.ops.undo({ id: "agent.unassign", token: back.undo });
  expect(await assigneeOf(deps, task.id)).toBe("agent");
  const [run] = await runsOf(deps, task.id);
  expect(run?.status).toBe("cancelled");
  await close();
});

test("unassign of a waiting run resolves its grant request", async () => {
  const { deps, caller, mkTask, file, close } = await setup();
  const task = await mkTask();
  const out = await caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  const grant = await file("Use the AWS connection?", { source: "agent" });
  await deps.db
    .update(agentRuns)
    .set({
      status: "waiting",
      pending: { requestId: grant.id, seq: 3, kind: "grant" },
    })
    .where(eq(agentRuns.id, out.result.run.id));
  const back = await caller.agent.unassign({
    id: task.id,
    expectedUpdatedAt: await version(deps, task.id),
  });
  expect(back.result.run).toMatchObject({ status: "cancelled", pending: null });
  const [req] = await deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, grant.id));
  expect(req?.outcome).toBe("handled");
  expect(await assigneeOf(deps, task.id)).toBe("me");
  await close();
});
