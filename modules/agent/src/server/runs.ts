import { requestOps } from "@dlh/module-requests/operations";
import { taskOps } from "@dlh/module-tasks/operations";
import {
  implementOperation,
  revokeRunTokens,
  type ScopedWriter,
  type Tx,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { agentRunMessages, agentRuns } from "../db/schema";
import { agentOps } from "../operations";
import {
  decision,
  pending,
  type RunRow,
  type RunStatus,
  runRow,
  runStatus,
} from "../schema";
import { canMove } from "./claimRules";

export type RunTableRow = typeof agentRuns.$inferSelect;

/** The run states that hold the task's one slot. */
export const LIVE = ["queued", "running", "waiting"] as const;

export function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

export function notFound(message: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}

/** Refuses a forward status change the run lifecycle doesn't allow. */
export function move(run: RunTableRow, to: RunStatus) {
  if (!canMove(runStatus.parse(run.status), to)) conflict("Changed since");
}

/** A writer method the operation's effects allow; absent only if the effects are wrong. */
export function allowed<T>(method: T | undefined): T {
  if (!method) throw new Error("Write outside the operation's effects");
  return method;
}

const iso = (d: Date | null) => d?.toISOString() ?? null;

/** A run as the API returns it: ISO times, and `cost_usd` (numeric, a string from the driver) as a number. */
export function toRunRow(row: RunTableRow): RunRow {
  return runRow.parse({
    ...row,
    heartbeatAt: iso(row.heartbeatAt),
    createdAt: row.createdAt.toISOString(),
    startedAt: iso(row.startedAt),
    finishedAt: iso(row.finishedAt),
    costUsd: Number(row.costUsd),
  });
}

/** The copy for a task whose one live-run slot is taken. */
export const ALREADY_LIVE = "The agent already has this task";

/** Postgres's unique violation on the one-live-run-per-task index. */
const liveRunClash = z.object({
  code: z.literal("23505"),
  constraint_name: z.literal("agent_runs_active_task_idx"),
});
const withCause = z.object({ cause: z.unknown() });

function isLiveRunClash(e: unknown): boolean {
  // Drizzle wraps the driver's error in `cause`.
  for (let c = e, depth = 0; c && depth < 4; depth++) {
    if (liveRunClash.safeParse(c).success) return true;
    c = withCause.safeParse(c).data?.cause;
  }
  return false;
}

/**
 * Runs a write that makes a run live. Two writers can both find no live run
 * (a lock on no rows locks nothing); the unique index stops the second, and
 * this gives it the copy rather than a database error.
 */
export async function holdingSlot<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (e) {
    if (isLiveRunClash(e)) conflict(ALREADY_LIVE);
    throw e;
  }
}

/** The task's live run, locked, if it has one. */
export async function liveRun(
  tx: Tx,
  taskId: string,
): Promise<RunTableRow | null> {
  const [row] = await tx
    .select()
    .from(agentRuns)
    .where(
      and(eq(agentRuns.taskId, taskId), inArray(agentRuns.status, [...LIVE])),
    )
    .for("update");
  return row ?? null;
}

/** The task's most recent run, locked. */
export async function latestRun(tx: Tx, taskId: string): Promise<RunTableRow> {
  const [row] = await tx
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, taskId))
    .orderBy(desc(agentRuns.createdAt), desc(agentRuns.id))
    .limit(1)
    .for("update");
  if (!row) notFound("No run");
  return row;
}

/** What resolving a run's request needs of `requests.get`'s result. */
const requestView = z.object({
  request: z.object({ updatedAt: z.string(), outcome: z.string().nullable() }),
});

/**
 * Resolves the request a run filed as handled, through `requests.get` and
 * `requests.resolve` (the operation must declare both). One already resolved
 * or gone is left.
 */
async function resolveRequest(w: ScopedWriter, requestId: string) {
  const call = allowed(w.call);
  let view: z.infer<typeof requestView>;
  try {
    view = requestView.parse(await call(requestOps.get, { id: requestId }));
  } catch (e) {
    if (e instanceof TRPCError && e.code === "NOT_FOUND") return;
    throw e;
  }
  if (view.request.outcome !== null) return;
  await call(requestOps.resolve, {
    id: requestId,
    expectedUpdatedAt: view.request.updatedAt,
    outcome: "handled",
  });
}

/**
 * Ends a live `run` as cancelled and revokes its run tokens. An approval or
 * grant it was waiting on is resolved as handled and cleared, so the Queue
 * doesn't keep asking about a run that has stopped.
 */
export async function cancelRun(w: ScopedWriter, run: RunTableRow, now: Date) {
  const asking =
    run.pending && run.pending.kind !== "failure" ? run.pending : null;
  if (asking) await resolveRequest(w, asking.requestId);
  const [row] = await w.tx
    .update(agentRuns)
    .set({
      status: "cancelled",
      finishedAt: now,
      ...(asking ? { pending: null } : {}),
    })
    .where(eq(agentRuns.id, run.id))
    .returning();
  if (!row) notFound("No run");
  await revokeRunTokens(w.tx, run.id);
  return row;
}

/**
 * Puts a cancelled run back as it was (`uncancel`), if it is still cancelled
 * and no claim has run since (a claim always sets `heartbeat_at`). `touch`:
 * whether the undo may touch the task, i.e. no callee undo checks its version.
 */
export const cancelRecord = z.object({
  runId: z.uuid(),
  taskId: z.uuid(),
  status: z.enum(["queued", "running", "waiting"]),
  pending: pending.nullable(),
  finishedAt: z.iso.datetime().nullable(),
  heartbeatAt: z.iso.datetime().nullable(),
  touch: z.boolean(),
});
export type CancelRecord = z.infer<typeof cancelRecord>;

/** The undo record of cancelling `before` (the run as it was). */
export function cancelUndo(before: RunTableRow, touch: boolean): CancelRecord {
  return {
    runId: before.id,
    taskId: before.taskId,
    status: runStatusOf(before.status),
    pending: before.pending,
    finishedAt: iso(before.finishedAt),
    heartbeatAt: iso(before.heartbeatAt),
    touch,
  };
}

function runStatusOf(status: string): CancelRecord["status"] {
  return cancelRecord.shape.status.parse(status);
}

/**
 * Undo of cancel and Back to me. Runs before the callee undos, which reopen
 * the approval or grant request (and give the task back to the agent). Its
 * revoked run tokens stay revoked: the next claim mints a new one.
 */
export async function uncancel(w: ScopedWriter, r: CancelRecord) {
  const [run] = await w.tx
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, r.runId))
    .for("update");
  if (run?.status !== "cancelled" || iso(run.heartbeatAt) !== r.heartbeatAt) {
    conflict("Changed since");
  }
  // A run since (assigned again) holds the task's slot, or has ended and is
  // what cancel and retry act on: only the latest run comes back.
  if ((await latestRun(w.tx, r.taskId)).id !== r.runId) {
    conflict("Changed since");
  }
  if (await liveRun(w.tx, r.taskId)) conflict("Changed since");
  await holdingSlot(() =>
    w.tx
      .update(agentRuns)
      .set({
        // A running run's container stopped when it was cancelled, so it goes
        // back to the queue and the next claim resumes its session.
        status: r.status === "running" ? "queued" : r.status,
        pending: r.pending,
        finishedAt: r.finishedAt === null ? null : new Date(r.finishedAt),
      })
      .where(eq(agentRuns.id, r.runId)),
  );
  if (r.touch) await allowed(w.touchItem)(r.taskId);
}

export const cancel = implementOperation(agentOps.cancel, {
  async run(w, input, deps) {
    const run = await latestRun(w.tx, input.id);
    if (run.status === "cancelled") {
      return { result: toRunRow(run), undo: null };
    }
    if (run.status === "done" || run.status === "failed") {
      conflict("This run has ended");
    }
    move(run, "cancelled");
    const row = await cancelRun(w, run, deps.now());
    await allowed(w.touchItem)(input.id);
    // The only callee record is the request's, so the undo may touch the task.
    return { result: toRunRow(row), undo: cancelUndo(run, true) };
  },
  undo: uncancel,
  undoRecord: cancelRecord.nullable(),
});

/**
 * Puts run `runId` back as it was before Retry, if it is still queued and
 * no claim has run since (a claim always sets `heartbeat_at`; `started_at`
 * keeps the first start).
 */
const retryRecord = z.object({
  runId: z.uuid(),
  taskId: z.uuid(),
  status: z.enum(["failed", "cancelled"]),
  pending: pending.nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  heartbeatAt: z.iso.datetime().nullable(),
  /** The allowance the run had used, which Retry reset. */
  runningMs: z.number().int(),
  costBaseUsd: z.string(),
});

/** What retry needs of `tasks.get`'s result. */
const taskView = z.object({
  task: z.object({ assignee: z.enum(["me", "agent"]) }),
});

export const retry = implementOperation(agentOps.retry, {
  async run(w, input) {
    const run = await latestRun(w.tx, input.id);
    if (run.status !== "failed" && run.status !== "cancelled") {
      conflict("Only a failed or cancelled run can be retried");
    }
    const { task } = taskView.parse(
      await allowed(w.call)(taskOps.get, { id: input.id }),
    );
    if (task.assignee !== "agent") conflict("This task is back with you");
    if (await liveRun(w.tx, input.id)) conflict(ALREADY_LIVE);
    move(run, "queued");
    if (run.pending?.kind === "failure") {
      await resolveRequest(w, run.pending.requestId);
    }
    const [row] = await holdingSlot(() =>
      w.tx
        .update(agentRuns)
        .set({
          status: "queued",
          pending: null,
          finishedAt: null,
          failureCode: null,
          failureMessage: null,
          // A fresh allowance: the caps count from here.
          runningMs: 0,
          costBaseUsd: run.costUsd,
        })
        .where(eq(agentRuns.id, run.id))
        .returning(),
    );
    if (!row) notFound("No run");
    await allowed(w.touchItem)(input.id);
    return {
      result: toRunRow(row),
      undo: {
        runId: run.id,
        taskId: run.taskId,
        status: run.status,
        pending: run.pending,
        failureCode: run.failureCode,
        failureMessage: run.failureMessage,
        finishedAt: iso(run.finishedAt),
        heartbeatAt: iso(run.heartbeatAt),
        runningMs: run.runningMs,
        costBaseUsd: run.costBaseUsd,
      },
    };
  },
  // Runs before the callee undo of `requests.resolve`, which reopens the failure request.
  async undo(w, r) {
    const [run] = await w.tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, r.runId))
      .for("update");
    if (run?.status !== "queued" || iso(run.heartbeatAt) !== r.heartbeatAt) {
      conflict("Changed since");
    }
    await w.tx
      .update(agentRuns)
      .set({
        status: r.status,
        pending: r.pending,
        failureCode: r.failureCode,
        failureMessage: r.failureMessage,
        finishedAt: r.finishedAt === null ? null : new Date(r.finishedAt),
        runningMs: r.runningMs,
        costBaseUsd: r.costBaseUsd,
      })
      .where(eq(agentRuns.id, r.runId));
    // Nothing else in this token touches the task, so its version can't conflict.
    await allowed(w.touchItem)(r.taskId);
  },
  undoRecord: retryRecord,
});

export const message = implementOperation(agentOps.message, {
  async run(w, input) {
    const [run] = await w.tx
      .select({ status: agentRuns.status })
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId))
      .for("share");
    if (!run) notFound("No run");
    if (run.status !== "running" && run.status !== "waiting") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This run has ended",
      });
    }
    const [row] = await w.tx
      .insert(agentRunMessages)
      .values({ runId: input.runId, body: input.body })
      .returning();
    if (!row) throw new Error("message not written");
    return {
      result: { id: row.id, at: row.at.toISOString(), body: row.body },
      undo: null,
    };
  },
  async undo() {},
  undoRecord: z.null(),
});

/**
 * Puts run `runId` back to waiting on `pending`, with its decision and
 * connections as they were, if it is still queued and no claim has run since
 * (a claim always sets `heartbeat_at`).
 */
const decideRecord = z.object({
  runId: z.uuid(),
  taskId: z.uuid(),
  pending,
  decision: decision.nullable(),
  connectionIds: z.array(z.uuid()),
  heartbeatAt: z.iso.datetime().nullable(),
});

export const decide = implementOperation(agentOps.decide, {
  async run(w, input) {
    const [run] = await w.tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId))
      .for("update");
    if (!run) notFound("No run");
    // The same answer again (pressed twice, or on two devices) is a no-op,
    // whatever has happened to the run since.
    if (run.decision?.seq === input.seq) {
      if (run.decision.approve !== input.approve) conflict("Already answered");
      return { result: toRunRow(run), undo: null };
    }
    const asked = run.pending;
    if (
      run.status !== "waiting" ||
      !asked ||
      asked.kind === "failure" ||
      asked.seq !== input.seq
    ) {
      conflict("Changed since");
    }
    move(run, "queued");
    await resolveRequest(w, asked.requestId);
    const granted =
      input.approve && asked.kind === "grant" && asked.connectionId
        ? asked.connectionId
        : null;
    const [row] = await holdingSlot(() =>
      w.tx
        .update(agentRuns)
        .set({
          status: "queued",
          pending: null,
          decision: {
            seq: input.seq,
            approve: input.approve,
            delivered: false,
          },
          ...(granted && !run.connectionIds.includes(granted)
            ? { connectionIds: [...run.connectionIds, granted] }
            : {}),
        })
        .where(eq(agentRuns.id, run.id))
        .returning(),
    );
    if (!row) notFound("No run");
    await allowed(w.touchItem)(run.taskId);
    return {
      result: toRunRow(row),
      undo: {
        runId: run.id,
        taskId: run.taskId,
        pending: asked,
        decision: run.decision,
        connectionIds: run.connectionIds,
        heartbeatAt: iso(run.heartbeatAt),
      },
    };
  },
  // Runs before the callee undo of `requests.resolve`, which reopens the request.
  async undo(w, r) {
    if (!r) return;
    const [run] = await w.tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, r.runId))
      .for("update");
    if (run?.status !== "queued" || iso(run.heartbeatAt) !== r.heartbeatAt) {
      conflict("Changed since");
    }
    await w.tx
      .update(agentRuns)
      .set({
        status: "waiting",
        pending: r.pending,
        decision: r.decision,
        connectionIds: r.connectionIds,
      })
      .where(eq(agentRuns.id, r.runId));
    await allowed(w.touchItem)(r.taskId);
  },
  undoRecord: decideRecord.nullable(),
});
