import { dueValue } from "@dlh/core";
import { requestOps } from "@dlh/module-requests/operations";
import { taskOps } from "@dlh/module-tasks/operations";
import {
  implementOperation,
  mintRunToken,
  revokeRunTokens,
  type ScopedWriter,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { z } from "zod";
import {
  agentAssignments,
  agentRunEvents,
  agentRunMessages,
  agentRuns,
} from "../db/schema";
import { agentOps } from "../operations";
import {
  type Decision,
  type RunRow,
  type RunStatus,
  runStatus,
} from "../schema";
import { canMove, isDueBy } from "./claimRules";
import {
  allowed,
  cancelRun,
  conflict,
  holdingSlot,
  type RunTableRow,
  toRunRow,
} from "./runs";
import { readSettings } from "./settings";

/** A running run with no heartbeat for this long goes back to the queue. */
const STALE_MS = 2 * 60_000;
/** Events are kept this long after their run ends. */
const EVENTS_KEPT_MS = 30 * 24 * 60 * 60_000;

/** Refuses a status change the lifecycle doesn't allow. */
function move(run: RunTableRow, to: RunStatus) {
  if (!canMove(runStatus.parse(run.status), to)) conflict("Changed since");
}

/** Whether `e` is a NOT_FOUND, i.e. the item is deleted. */
const isNotFound = (e: unknown) =>
  e instanceof TRPCError && e.code === "NOT_FOUND";

/** Touches the run's task; a deleted one has no screen to refresh. */
async function touchTask(w: ScopedWriter, taskId: string) {
  try {
    await allowed(w.touchItem)(taskId);
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
}

/** What claim needs of `tasks.get`'s result. */
const taskView = z.object({
  task: z.object({
    id: z.string(),
    title: z.string(),
    notes: z.string().nullable(),
    completedAt: z.string().nullable(),
    assignee: z.enum(["me", "agent"]),
    due: dueValue.nullable(),
  }),
});
type TaskView = z.infer<typeof taskView>["task"];

/** The task, or null when it is deleted. */
async function readTask(
  w: ScopedWriter,
  id: string,
  timeZone: string,
): Promise<TaskView | null> {
  try {
    return taskView.parse(await allowed(w.call)(taskOps.get, { id, timeZone }))
      .task;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** What claim needs of `requests.get`'s result. */
const requestView = z.object({
  request: z.object({
    body: z.string().nullable(),
    fromName: z.string().nullable(),
    sourceHandle: z.string().nullable(),
  }),
});

/** The request the task was given from, or null when there is none or it is gone. */
async function readRequest(w: ScopedWriter, taskId: string) {
  const [assignment] = await w.tx
    .select({ requestId: agentAssignments.requestId })
    .from(agentAssignments)
    .where(eq(agentAssignments.taskId, taskId));
  if (!assignment?.requestId) return null;
  try {
    const { request } = requestView.parse(
      await allowed(w.call)(requestOps.get, { id: assignment.requestId }),
    );
    return {
      sender: request.fromName ?? request.sourceHandle,
      body: request.body,
    };
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

/** Running runs with no heartbeat since `before` go back to the queue, their tokens revoked. */
async function sweepStale(w: ScopedWriter, before: Date) {
  const stale = await w.tx
    .select()
    .from(agentRuns)
    .where(
      and(eq(agentRuns.status, "running"), lt(agentRuns.heartbeatAt, before)),
    )
    .for("update");
  for (const run of stale) {
    move(run, "queued");
    await holdingSlot(() =>
      w.tx
        .update(agentRuns)
        .set({ status: "queued" })
        .where(eq(agentRuns.id, run.id)),
    );
    await revokeRunTokens(w.tx, run.id);
    await touchTask(w, run.taskId);
  }
}

/** Deletes the events of runs that ended before `before`. */
async function sweepEvents(w: ScopedWriter, before: Date) {
  const ended = w.tx
    .select({ id: agentRuns.id })
    .from(agentRuns)
    .where(
      and(isNotNull(agentRuns.finishedAt), lt(agentRuns.finishedAt, before)),
    );
  await w.tx.delete(agentRunEvents).where(inArray(agentRunEvents.runId, ended));
}

/**
 * Cancels each queued or waiting run whose task is completed, deleted or no
 * longer the agent's, and returns the queued runs left, oldest first, with
 * their tasks.
 */
async function sweepQueue(w: ScopedWriter, now: Date, timeZone: string) {
  const runs = await w.tx
    .select()
    .from(agentRuns)
    .where(inArray(agentRuns.status, ["queued", "waiting"]))
    .orderBy(asc(agentRuns.createdAt), asc(agentRuns.id))
    .for("update");
  const queued: { run: RunTableRow; task: TaskView }[] = [];
  for (const run of runs) {
    const task = await readTask(w, run.taskId, timeZone);
    if (task && task.completedAt === null && task.assignee === "agent") {
      if (run.status === "queued") queued.push({ run, task });
      continue;
    }
    move(run, "cancelled");
    await cancelRun(w, run, now);
    if (task) await touchTask(w, run.taskId);
  }
  return queued;
}

/** Hands over the run's messages not yet delivered, oldest first. */
async function deliverMessages(w: ScopedWriter, runId: string, now: Date) {
  const rows = await w.tx
    .update(agentRunMessages)
    .set({ deliveredAt: now })
    .where(
      and(
        eq(agentRunMessages.runId, runId),
        isNull(agentRunMessages.deliveredAt),
      ),
    )
    .returning();
  return rows
    .sort((a, b) => a.at.getTime() - b.at.getTime() || a.id.localeCompare(b.id))
    .map((m) => ({ id: m.id, at: m.at.toISOString(), body: m.body }));
}

/** What a claim hands the worker: nothing, or a run to start and what its container needs. */
export type ClaimResult =
  | { run: null }
  | {
      run: RunRow;
      token: string;
      task: { id: string; title: string; notes: string | null };
      request: { sender: string | null; body: string | null } | null;
      connectionIds: string[];
      sessionId: string | null;
      decision: Decision | null;
      messages: { id: string; at: string; body: string }[];
    };

export const claim = implementOperation(agentOps.claim, {
  async run(w, _input, deps): Promise<{ result: ClaimResult; undo: null }> {
    const now = deps.now();
    // One claim at a time, so the parallel limit can't be overshot.
    await w.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('agent.claim'))`,
    );
    const settings = await readSettings(w.tx);
    await sweepStale(w, new Date(now.getTime() - STALE_MS));
    await sweepEvents(w, new Date(now.getTime() - EVENTS_KEPT_MS));
    const queued = await sweepQueue(w, now, settings.timeZone);

    const [counted] = await w.tx
      .select({ n: sql<number>`count(*)::int` })
      .from(agentRuns)
      .where(eq(agentRuns.status, "running"));
    if ((counted?.n ?? 0) >= settings.maxParallel) {
      return { result: { run: null }, undo: null };
    }
    const next = queued.find(({ task }) =>
      isDueBy(task.due, now, settings.timeZone),
    );
    if (!next) return { result: { run: null }, undo: null };

    const { run, task } = next;
    move(run, "running");
    // A decision goes with the first claim after it, and is kept as delivered.
    const decision =
      run.decision && !run.decision.delivered
        ? { ...run.decision, delivered: true }
        : null;
    const [row] = await holdingSlot(() =>
      w.tx
        .update(agentRuns)
        .set({
          status: "running",
          startedAt: run.startedAt ?? now,
          heartbeatAt: now,
          ...(decision ? { decision } : {}),
        })
        .where(eq(agentRuns.id, run.id))
        .returning(),
    );
    if (!row) conflict("Changed since");
    // Only the claim's token works for the run from here.
    await revokeRunTokens(w.tx, run.id);
    const token = await mintRunToken(w.tx, run.id);
    await touchTask(w, run.taskId);
    return {
      result: {
        run: toRunRow(row),
        token,
        task: { id: task.id, title: task.title, notes: task.notes },
        request: await readRequest(w, run.taskId),
        connectionIds: row.connectionIds,
        sessionId: row.sessionId,
        decision,
        messages: await deliverMessages(w, run.id, now),
      },
      undo: null,
    };
  },
  async undo() {},
  undoRecord: z.null(),
});
