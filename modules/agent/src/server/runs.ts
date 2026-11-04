import { requestOps } from "@dlh/module-requests/operations";
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
import { pending, type RunRow, runRow } from "../schema";

export type RunTableRow = typeof agentRuns.$inferSelect;

/** The run states that hold the task's one slot. */
export const LIVE = ["queued", "running", "waiting"] as const;

export function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

export function notFound(message: string): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
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
async function latestRun(tx: Tx, taskId: string): Promise<RunTableRow> {
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

export const cancel = implementOperation(agentOps.cancel, {
  async run(w, input, deps) {
    const run = await latestRun(w.tx, input.id);
    if (run.status === "cancelled") {
      return { result: toRunRow(run), undo: null };
    }
    if (run.status === "done" || run.status === "failed") {
      conflict("This run has ended");
    }
    const row = await cancelRun(w, run, deps.now());
    await allowed(w.touchItem)(input.id);
    return { result: toRunRow(row), undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

/**
 * Puts run `runId` back as it was before Retry, if it is still queued and
 * no claim has started it since (a claim sets `started_at`).
 */
const retryRecord = z.object({
  runId: z.uuid(),
  taskId: z.uuid(),
  status: z.enum(["failed", "cancelled"]),
  pending: pending.nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  startedAt: z.iso.datetime().nullable(),
});

export const retry = implementOperation(agentOps.retry, {
  async run(w, input) {
    const run = await latestRun(w.tx, input.id);
    if (run.status !== "failed" && run.status !== "cancelled") {
      conflict("Only a failed or cancelled run can be retried");
    }
    if (run.pending?.kind === "failure") {
      await resolveRequest(w, run.pending.requestId);
    }
    const [row] = await w.tx
      .update(agentRuns)
      .set({
        status: "queued",
        pending: null,
        finishedAt: null,
        failureCode: null,
        failureMessage: null,
      })
      .where(eq(agentRuns.id, run.id))
      .returning();
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
        startedAt: iso(run.startedAt),
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
    if (run?.status !== "queued" || iso(run.startedAt) !== r.startedAt) {
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
