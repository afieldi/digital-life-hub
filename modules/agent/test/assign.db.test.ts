import { mintRunToken } from "@dlh/server";
import { expectTracked } from "@dlh/server/testing";
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

test("unassign undo restores the assignee and the run", async () => {
  const { deps, caller, mkTask, file, close } = await setup();
  const task = await mkTask();
  const out = await caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  const grant = await file("Use the AWS connection?", { source: "agent" });
  const pendingGrant = { requestId: grant.id, seq: 3, kind: "grant" } as const;
  await deps.db
    .update(agentRuns)
    .set({ status: "waiting", pending: pendingGrant })
    .where(eq(agentRuns.id, out.result.run.id));
  const back = await caller.agent.unassign({
    id: task.id,
    expectedUpdatedAt: await version(deps, task.id),
  });
  await caller.ops.undo({ id: "agent.unassign", token: back.undo });
  expect(await assigneeOf(deps, task.id)).toBe("agent");
  const [run] = await runsOf(deps, task.id);
  expect(run).toMatchObject({
    status: "waiting",
    pending: pendingGrant,
    finishedAt: null,
  });
  const [req] = await deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, grant.id));
  expect(req?.outcome).toBeNull();
  await close();
});

type S = Awaited<ReturnType<typeof setup>>;

/** A task of the agent's whose one run failed, with its open "Needs you". */
async function failedTask(s: S) {
  const task = await s.mkTask();
  await s.deps.db.execute(
    sql`update tasks set assignee = 'agent' where item_id = ${task.id}`,
  );
  const failure = await s.file("Needs you: Fix the build", { source: "agent" });
  const [run] = await s.deps.db
    .insert(agentRuns)
    .values({
      taskId: task.id,
      status: "failed",
      finishedAt: new Date(),
      failures: 1,
      pending: { requestId: failure.id, seq: 1, kind: "failure" },
    })
    .returning();
  if (!run) throw new Error("no run");
  return { task, run, failure };
}

async function outcomeOf(s: S, requestId: string) {
  const [req] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, requestId));
  return req?.outcome;
}

test("unassign undo on a failed run sets the assignee back", async () => {
  const s = await setup();
  const { task } = await failedTask(s);
  const back = await s.caller.agent.unassign({
    id: task.id,
    expectedUpdatedAt: await version(s.deps, task.id),
  });
  expect(back.result.run).toBeNull();
  expect(back.undo.record).toBeNull();
  expect(await assigneeOf(s.deps, task.id)).toBe("me");
  await s.caller.ops.undo({ id: "agent.unassign", token: back.undo });
  expect(await assigneeOf(s.deps, task.id)).toBe("agent");
  await s.close();
});

test("unassign resolves the failed run's open failure request; undo reopens it", async () => {
  const s = await setup();
  const { task, failure } = await failedTask(s);
  const back = await s.caller.agent.unassign({
    id: task.id,
    expectedUpdatedAt: await version(s.deps, task.id),
  });
  expect(await outcomeOf(s, failure.id)).toBe("handled");
  await s.caller.ops.undo({ id: "agent.unassign", token: back.undo });
  expect(await outcomeOf(s, failure.id)).toBeNull();
  await s.close();
});

test("assign resolves the failed run's open failure request; undo reopens it", async () => {
  const s = await setup();
  const { task, failure } = await failedTask(s);
  const out = await s.caller.agent.assign({
    id: task.id,
    expectedUpdatedAt: await version(s.deps, task.id),
  });
  expect(await outcomeOf(s, failure.id)).toBe("handled");
  await s.caller.ops.undo({ id: "agent.assign", token: out.undo });
  expect(await outcomeOf(s, failure.id)).toBeNull();
  expect(await runsOf(s.deps, task.id)).toHaveLength(1);
  await s.close();
});

test("assigning a task the agent already has publishes the new run, and its undo too", async () => {
  const s = await setup();
  const { task } = await failedTask(s);
  let undo: unknown;
  await expectTracked(s.deps, { itemId: task.id }, async () => {
    const out = await s.caller.agent.assign({
      id: task.id,
      expectedUpdatedAt: await version(s.deps, task.id),
    });
    undo = out.undo;
  });
  expect(await runsOf(s.deps, task.id)).toHaveLength(2);
  await expectTracked(s.deps, { itemId: task.id }, () =>
    s.caller.ops.undo({
      id: "agent.assign",
      token: undo as Parameters<typeof s.caller.ops.undo>[0]["token"],
    }),
  );
  expect(await runsOf(s.deps, task.id)).toHaveLength(1);
  expect(await assigneeOf(s.deps, task.id)).toBe("agent");
  await s.close();
});

test("assign and assignRequest refuse an unknown or disabled connection", async () => {
  const s = await setup();
  const [off] = await s.deps.db
    .insert(agentConnections)
    .values({ name: "old", type: "github", disabledAt: new Date() })
    .returning();
  const unknown = "0190f2a0-0000-7000-8000-000000000000";
  const task = await s.mkTask();
  const r = await s.file("Update the deps");
  for (const connections of [[unknown], [off.id]]) {
    await expect(
      s.caller.agent.assign({
        id: task.id,
        expectedUpdatedAt: task.updatedAt,
        connections,
      }),
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Unknown or disabled connection",
    });
    await expect(
      s.caller.agent.assignRequest({
        id: r.id,
        expectedUpdatedAt: r.updatedAt,
        connections,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  expect(await s.deps.db.select().from(agentRuns)).toHaveLength(0);
  expect(await assigneeOf(s.deps, task.id)).toBe("me");
  await s.close();
});
