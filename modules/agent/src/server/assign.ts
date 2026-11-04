import { item as itemSchema } from "@dlh/core";
import { requestOps } from "@dlh/module-requests/operations";
import { taskOps } from "@dlh/module-tasks/operations";
import { implementOperation, type ScopedWriter, type Tx } from "@dlh/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { agentAssignments, agentRuns } from "../db/schema";
import { agentOps } from "../operations";
import {
  ALREADY_LIVE,
  allowed,
  cancelRecord,
  cancelRun,
  cancelUndo,
  conflict,
  holdingSlot,
  liveRun,
  toRunRow,
  uncancel,
} from "./runs";
import { readSettings } from "./settings";

/**
 * Deletes run `runId` if it is still queued, then restores the task's
 * assignment (`assignment`, the connections it had, or none).
 */
const assignRecord = z.object({
  runId: z.uuid(),
  assignment: z.array(z.uuid()).nullable(),
});
type AssignRecord = z.infer<typeof assignRecord>;

/** Refuses a task that already has a live run: it has the task's one slot. */
async function refuseLive(tx: Tx, taskId: string) {
  if (await liveRun(tx, taskId)) conflict(ALREADY_LIVE);
}

/**
 * Stores the task's connections (the defaults when none are given) and queues
 * its run. Returns the run and the connections the assignment had before.
 */
async function queue(
  tx: Tx,
  taskId: string,
  opts: { connections?: string[]; requestId?: string },
) {
  const connectionIds =
    opts.connections ?? (await readSettings(tx)).defaultConnectionIds;
  const [before] = await tx
    .select({ connectionIds: agentAssignments.connectionIds })
    .from(agentAssignments)
    .where(eq(agentAssignments.taskId, taskId))
    .for("update");
  await tx
    .insert(agentAssignments)
    .values({ taskId, connectionIds, requestId: opts.requestId ?? null })
    .onConflictDoUpdate({
      target: agentAssignments.taskId,
      // A task given from a request keeps its request when assigned again.
      set: { connectionIds },
    });
  const [run] = await holdingSlot(() =>
    tx
      .insert(agentRuns)
      .values({ taskId, status: "queued", connectionIds })
      .returning(),
  );
  if (!run) throw new Error("run not written");
  return { run: toRunRow(run), before: before?.connectionIds ?? null };
}

/** Undo of assign and assignRequest: the run must not have been claimed. Does not touch the task. */
async function unqueue(w: ScopedWriter, r: AssignRecord) {
  const [run] = await w.tx
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, r.runId))
    .for("update");
  if (run?.status !== "queued") conflict("Changed since");
  await w.tx.delete(agentRuns).where(eq(agentRuns.id, r.runId));
  if (r.assignment === null) {
    await w.tx
      .delete(agentAssignments)
      .where(eq(agentAssignments.taskId, run.taskId));
  } else {
    await w.tx
      .update(agentAssignments)
      .set({ connectionIds: r.assignment })
      .where(eq(agentAssignments.taskId, run.taskId));
  }
}

// assign and assignRequest don't touch the task: setAssignee's version bump
// already publishes it, and a touch after it would make its undo conflict.

export const assign = implementOperation(agentOps.assign, {
  async run(w, input) {
    await refuseLive(w.tx, input.id);
    const task = itemSchema.parse(
      await allowed(w.call)(taskOps.setAssignee, {
        id: input.id,
        expectedUpdatedAt: input.expectedUpdatedAt,
        assignee: "agent",
      }),
    );
    const { run, before } = await queue(w.tx, task.id, {
      connections: input.connections,
    });
    return {
      result: { task, run },
      undo: { runId: run.id, assignment: before },
    };
  },
  undo: unqueue,
  undoRecord: assignRecord,
});

/** What assignRequest needs of `requests.get`'s result. */
const requestView = z.object({
  request: z.object({
    title: z.string(),
    body: z.string().nullable(),
    outcome: z.string().nullable(),
  }),
});

export const assignRequest = implementOperation(agentOps.assignRequest, {
  async run(w, input) {
    const call = allowed(w.call);
    const { request } = requestView.parse(
      await call(requestOps.get, { id: input.id }),
    );
    if (request.outcome !== null) conflict("Already resolved");
    const created = itemSchema.parse(
      await call(taskOps.create, {
        title: input.title ?? request.title,
        notes: input.notes ?? request.body ?? undefined,
      }),
    );
    const task = itemSchema.parse(
      await call(taskOps.setAssignee, {
        id: created.id,
        expectedUpdatedAt: created.updatedAt,
        assignee: "agent",
      }),
    );
    await call(requestOps.resolve, {
      id: input.id,
      expectedUpdatedAt: input.expectedUpdatedAt,
      outcome: "task",
      taskId: task.id,
    });
    const { run, before } = await queue(w.tx, task.id, {
      connections: input.connections,
      requestId: input.id,
    });
    // Core reverts resolve and setAssignee through their records and deletes the task.
    return {
      result: { task, run },
      undo: { runId: run.id, assignment: before },
    };
  },
  undo: unqueue,
  undoRecord: assignRecord,
});

export const unassign = implementOperation(agentOps.unassign, {
  async run(w, input, deps) {
    const task = itemSchema.parse(
      await allowed(w.call)(taskOps.setAssignee, {
        id: input.id,
        expectedUpdatedAt: input.expectedUpdatedAt,
        assignee: "me",
      }),
    );
    const live = await liveRun(w.tx, input.id);
    const run = live ? await cancelRun(w, live, deps.now()) : null;
    // setAssignee's bump publishes the task. Only when it changed nothing (the
    // task was already yours) is touching safe, and needed to show the run;
    // the undo touches on the same terms, so setAssignee's undo can't conflict.
    const touch = task.updatedAt === input.expectedUpdatedAt;
    if (run && touch) await allowed(w.touchItem)(input.id);
    return {
      result: { task, run: run && toRunRow(run) },
      undo: live ? cancelUndo(live, touch) : null,
    };
  },
  // Restores the run; the callee records reopen its request and give the task back to the agent.
  undo: uncancel,
  undoRecord: cancelRecord.nullable(),
});
