import { item as itemSchema } from "@dlh/core";
import { requestOps } from "@dlh/module-requests/operations";
import { taskOps } from "@dlh/module-tasks/operations";
import { implementOperation, type ScopedWriter, type Tx } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { agentAssignments, agentRuns } from "../db/schema";
import { agentOps } from "../operations";
import type { Audience } from "../schema";
import { liveConnections } from "./connections";
import {
  ALREADY_LIVE,
  allowed,
  cancelRecord,
  cancelRun,
  cancelUndo,
  conflict,
  holdingSlot,
  liveRun,
  resolveFailure,
  toRunRow,
  uncancel,
} from "./runs";
import { readSettings } from "./settings";

/**
 * Deletes run `runId` if it is still queued, then restores the task's
 * assignment (`assignment`, the connections it had, or none). `touch`: the
 * task was already the agent's, so no setAssignee undo publishes it.
 */
const assignRecord = z.object({
  runId: z.uuid(),
  assignment: z.array(z.uuid()).nullable(),
  touch: z.boolean(),
});
type AssignRecord = z.infer<typeof assignRecord>;

/** Refuses a task that already has a live run: it has the task's one slot. */
async function refuseLive(tx: Tx, taskId: string) {
  if (await liveRun(tx, taskId)) conflict(ALREADY_LIVE);
}

/**
 * The audience of the task's latest run that had one, if the task was given
 * from a request: a coworker's task assigned again still answers to them.
 */
async function keptAudience(
  tx: Tx,
  taskId: string,
  requestId: string | null | undefined,
): Promise<Audience | null> {
  if (!requestId) return null;
  const [run] = await tx
    .select({ audience: agentRuns.audience })
    .from(agentRuns)
    .where(and(eq(agentRuns.taskId, taskId), isNotNull(agentRuns.audience)))
    .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
    .limit(1);
  return run?.audience ?? null;
}

/**
 * Stores the task's connections and queues its run. A run with an audience
 * (`opts.audience`, or kept from the task's request) starts with the coworker
 * connections, any other with the defaults, unless connections are given
 * (which must be live). Returns the run and the connections the assignment
 * had before.
 */
async function queue(
  tx: Tx,
  taskId: string,
  opts: { connections?: string[]; requestId?: string; audience?: Audience },
) {
  const [before] = await tx
    .select({
      connectionIds: agentAssignments.connectionIds,
      requestId: agentAssignments.requestId,
    })
    .from(agentAssignments)
    .where(eq(agentAssignments.taskId, taskId))
    .for("update");
  const audience =
    opts.audience ?? (await keptAudience(tx, taskId, before?.requestId));
  const settings = opts.connections ? null : await readSettings(tx);
  const connectionIds = opts.connections
    ? await liveConnections(tx, opts.connections)
    : audience
      ? (settings?.coworkerConnectionIds ?? [])
      : (settings?.defaultConnectionIds ?? []);
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
      .values({ taskId, status: "queued", connectionIds, audience })
      .returning(),
  );
  if (!run) throw new Error("run not written");
  return { run: toRunRow(run), before: before?.connectionIds ?? null };
}

/**
 * Undo of assign and assignRequest: the run must not have been claimed.
 * Touches the task only when `r.touch`; otherwise setAssignee's undo does.
 */
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
  if (r.touch) await allowed(w.touchItem)(run.taskId);
}

// setAssignee's version bump publishes the task, and a touch after it would
// make its undo conflict. Only when it changed nothing (the task was already
// the agent's) is touching safe, and needed to show the new run.

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
    await resolveFailure(w, task.id);
    const { run, before } = await queue(w.tx, task.id, {
      connections: input.connections,
    });
    const touch = task.updatedAt === input.expectedUpdatedAt;
    if (touch) await allowed(w.touchItem)(task.id);
    return {
      result: { task, run },
      undo: { runId: run.id, assignment: before, touch },
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
    source: z.string(),
    sourceHandle: z.string().nullable(),
    fromOwner: z.boolean(),
  }),
});

/**
 * A coworker's Slack request (not one you sent) makes a run that answers to
 * them. One with no sender can't be kept to them, so it is refused.
 */
function audienceOf(
  request: z.infer<typeof requestView>["request"],
): Audience | undefined {
  if (request.source !== "slack" || request.fromOwner) return undefined;
  if (!request.sourceHandle) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This Slack request has no sender",
    });
  }
  return { asker: { slackUserId: request.sourceHandle, githubLogin: null } };
}

export const assignRequest = implementOperation(agentOps.assignRequest, {
  async run(w, input) {
    const call = allowed(w.call);
    const { request } = requestView.parse(
      await call(requestOps.get, { id: input.id }),
    );
    if (request.outcome !== null) conflict("Already resolved");
    const audience = audienceOf(request);
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
      ...(audience ? { audience } : {}),
    });
    // Core reverts resolve and setAssignee through their records and deletes the task.
    return {
      result: { task, run },
      undo: { runId: run.id, assignment: before, touch: false },
    };
  },
  undo: unqueue,
  undoRecord: assignRecord,
});

export const unassign = implementOperation(agentOps.unassign, {
  async run(w, input, deps) {
    // The run is locked before the task, as claim and heartbeat lock them.
    const live = await liveRun(w.tx, input.id);
    const task = itemSchema.parse(
      await allowed(w.call)(taskOps.setAssignee, {
        id: input.id,
        expectedUpdatedAt: input.expectedUpdatedAt,
        assignee: "me",
      }),
    );
    if (!live) await resolveFailure(w, input.id);
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
