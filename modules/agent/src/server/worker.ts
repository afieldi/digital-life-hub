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
import {
  and,
  asc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  max,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import {
  agentAssignments,
  agentConnections,
  agentRunEvents,
  agentRunMessages,
  agentRuns,
  agentSettings,
} from "../db/schema";
import { agentOps } from "../operations";
import type { Decision, Pending, RunRow } from "../schema";
import { isDueBy } from "./claimRules";
import {
  allowed,
  cancelRun,
  conflict,
  holdingSlot,
  move,
  notFound,
  type RunTableRow,
  toRunRow,
} from "./runs";
import { readSettings } from "./settings";

/** A running run with no heartbeat for this long goes back to the queue. */
const STALE_MS = 2 * 60_000;
/** Events are kept this long after their run ends. */
const EVENTS_KEPT_MS = 30 * 24 * 60 * 60_000;

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
    updatedAt: z.string(),
  }),
});
type TaskView = z.infer<typeof taskView>["task"];

/** The task, or null when it is deleted. */
async function readTask(
  w: ScopedWriter,
  id: string,
  timeZone?: string,
): Promise<TaskView | null> {
  try {
    return taskView.parse(
      await allowed(w.call)(taskOps.get, {
        id,
        ...(timeZone ? { timeZone } : {}),
      }),
    ).task;
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
    source: z.string(),
    sourceHandle: z.string().nullable(),
    sourceUrl: z.string().nullable(),
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
      id: assignment.requestId,
      sender: request.fromName ?? request.sourceHandle,
      body: request.body,
      source: request.source,
      sourceUrl: request.sourceUrl,
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

/**
 * The last sequence number the run has used: its latest event's, or a
 * pending request's or decision's if later; 0 for none. A resumed session
 * goes on after it.
 */
async function lastSeqOf(w: ScopedWriter, run: RunTableRow): Promise<number> {
  const [row] = await w.tx
    .select({ seq: max(agentRunEvents.seq) })
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, run.id));
  return Math.max(row?.seq ?? 0, run.pending?.seq ?? 0, run.decision?.seq ?? 0);
}

/** What a claim hands the worker: nothing, or a run to start and what its container needs. */
export type ClaimResult =
  | { run: null }
  | {
      run: RunRow;
      token: string;
      task: { id: string; title: string; notes: string | null };
      request: {
        id: string;
        sender: string | null;
        body: string | null;
        source: string;
        sourceUrl: string | null;
      } | null;
      instructions: string;
      /** Every connection that isn't disabled, not only the run's granted ones. */
      connections: {
        id: string;
        name: string;
        type: string;
        scopeSummary: string;
      }[];
      connectionIds: string[];
      sessionId: string | null;
      decision: Decision | null;
      messages: { id: string; at: string; body: string }[];
      lastSeq: number;
    };

export const claim = implementOperation(agentOps.claim, {
  async run(w, _input, deps): Promise<{ result: ClaimResult; undo: null }> {
    const now = deps.now();
    // One claim at a time, so the parallel limit can't be overshot.
    await w.tx.execute(
      sql`select pg_advisory_xact_lock(hashtext('agent.claim'))`,
    );
    const settings = await readSettings(w.tx);
    // Every claim shows the worker is up, whether or not it gets a run.
    await w.tx.update(agentSettings).set({ workerSeenAt: now });
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
        instructions: settings.instructions,
        connections: await w.tx
          .select({
            id: agentConnections.id,
            name: agentConnections.name,
            type: agentConnections.type,
            scopeSummary: agentConnections.scopeSummary,
          })
          .from(agentConnections)
          .where(isNull(agentConnections.disabledAt))
          .orderBy(asc(agentConnections.name)),
        connectionIds: row.connectionIds,
        sessionId: row.sessionId,
        decision,
        messages: await deliverMessages(w, run.id, now),
        lastSeq: await lastSeqOf(w, row),
      },
      undo: null,
    };
  },
  async undo() {},
  undoRecord: z.null(),
});

/** Ended runs: a worker still calling about one is told so. */
const ENDED: readonly string[] = ["done", "failed", "cancelled"];

/** Run `runId`, locked. */
async function lockRun(w: ScopedWriter, runId: string) {
  const [run] = await w.tx
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, runId))
    .for("update");
  if (!run) notFound("No run");
  return run;
}

/** `CONFLICT` unless `run` is running. */
function mustRun(run: RunTableRow) {
  if (run.status !== "running") {
    conflict(
      ENDED.includes(run.status) ? "This run has ended" : "Changed since",
    );
  }
}

/** Run `runId`, locked; `CONFLICT` unless it is running. */
async function runningRun(w: ScopedWriter, runId: string) {
  const run = await lockRun(w, runId);
  mustRun(run);
  return run;
}

/** An item title's longest. */
const MAX_TITLE = 500;

/** "Needs you: <title>", cut to the title limit with a trailing "…". */
function needsYou(title: string): string {
  const full = `Needs you: ${title}`;
  return full.length <= MAX_TITLE ? full : `${full.slice(0, MAX_TITLE - 1)}…`;
}

/**
 * What suspend and fail need of `requests.file`'s result. A request already
 * filed with the run's next id wasn't filed by this run, so it is refused.
 */
const filedView = z.object({
  request: z.object({ id: z.uuid() }),
  existing: z.boolean(),
});
function filed(result: unknown) {
  const out = filedView.parse(result);
  if (out.existing) conflict("Already filed");
  return out;
}

/**
 * Ends a running run as failed: files "Needs you: <task>" with the message
 * and a Retry action (once per failure, by `externalId`), keeps that request
 * as the run's pending one, revokes its tokens and touches its task.
 */
async function failRun(
  w: ScopedWriter,
  run: RunTableRow,
  task: { id: string; title: string },
  failure: { code: string; message: string },
  now: Date,
) {
  move(run, "failed");
  const attempt = run.failures + 1;
  const { request } = filed(
    await allowed(w.call)(requestOps.file, {
      title: needsYou(task.title),
      body: failure.message,
      source: "agent",
      externalId: `${run.id}:fail:${attempt}`,
      actions: [
        { label: "Retry", operation: "agent.retry", input: { id: task.id } },
      ],
    }),
  );
  const [row] = await w.tx
    .update(agentRuns)
    .set({
      status: "failed",
      failures: attempt,
      pending: { requestId: request.id, seq: attempt, kind: "failure" },
      failureCode: failure.code,
      failureMessage: failure.message,
      finishedAt: now,
    })
    .where(eq(agentRuns.id, run.id))
    .returning();
  if (!row) notFound("No run");
  await revokeRunTokens(w.tx, run.id);
  await touchTask(w, run.taskId);
  return row;
}

/** Cancels a running run whose task is gone (`taskLive` false) or no longer the agent's. */
async function cancelRunning(
  w: ScopedWriter,
  run: RunTableRow,
  taskLive: boolean,
  now: Date,
) {
  move(run, "cancelled");
  const row = await cancelRun(w, run, now);
  if (taskLive) await touchTask(w, run.taskId);
  return row;
}

/**
 * The cap a run has reached in its current allowance (since its last Retry),
 * if any: the cost spent, or the running time.
 */
function capReached(
  run: RunTableRow,
  limits: { maxCostUsd: number; maxRunningMinutes: number },
) {
  if (Number(run.costUsd) - Number(run.costBaseUsd) >= limits.maxCostUsd) {
    const cap = limits.maxCostUsd.toFixed(2);
    return { code: "cost_cap", message: `Cost cap reached ($${cap})` };
  }
  if (run.runningMs >= limits.maxRunningMinutes * 60_000) {
    const cap = limits.maxRunningMinutes;
    return { code: "time_cap", message: `Time cap reached (${cap} min)` };
  }
  return null;
}

/** Milliseconds from `since` to `now`; none without a `since`, or if the clock went back. */
const elapsedMs = (since: Date | null, now: Date) =>
  since ? Math.max(0, now.getTime() - since.getTime()) : 0;

export const heartbeat = implementOperation(agentOps.heartbeat, {
  async run(w, input, deps) {
    const now = deps.now();
    const [run] = await w.tx
      .select()
      .from(agentRuns)
      .where(eq(agentRuns.id, input.runId))
      .for("update");
    // Requeued by the stale sweep, cancelled or ended: this container stops.
    if (run?.status !== "running") {
      return { result: { stop: true }, undo: null };
    }
    const [beaten] = await w.tx
      .update(agentRuns)
      .set({
        heartbeatAt: now,
        // Since the last heartbeat or the claim, so time queued or waiting isn't counted.
        runningMs: run.runningMs + elapsedMs(run.heartbeatAt, now),
        turns: input.turns,
        inputTokens: input.inputTokens,
        outputTokens: input.outputTokens,
        costUsd: String(input.costUsd),
        // The image is kept from the first heartbeat that sends one.
        ...(input.image && !run.image ? { image: input.image } : {}),
        ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      })
      .where(eq(agentRuns.id, run.id))
      .returning();
    if (!beaten) notFound("No run");
    const task = await readTask(w, run.taskId);
    if (!task || task.completedAt !== null || task.assignee !== "agent") {
      await cancelRunning(w, beaten, task !== null, now);
      return { result: { stop: true }, undo: null };
    }
    const settings = await readSettings(w.tx);
    const cap = capReached(beaten, settings);
    if (cap) {
      await failRun(w, beaten, task, cap, now);
      return { result: { stop: true }, undo: null };
    }
    return { result: { stop: false }, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

export const appendEvents = implementOperation(agentOps.appendEvents, {
  async run(w, input) {
    await runningRun(w, input.runId);
    if (input.events.length > 0) {
      await w.tx
        .insert(agentRunEvents)
        .values(
          input.events.map((e) => ({
            runId: input.runId,
            seq: e.seq,
            at: new Date(e.at),
            kind: e.kind,
            data: e.data,
          })),
        )
        // A batch sent again after a lost answer adds nothing twice.
        .onConflictDoNothing();
    }
    return { result: {}, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

export const takeMessages = implementOperation(agentOps.takeMessages, {
  async run(w, input, deps) {
    await runningRun(w, input.runId);
    const messages = await deliverMessages(w, input.runId, deps.now());
    return { result: { messages }, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

export const suspend = implementOperation(agentOps.suspend, {
  async run(w, input) {
    const run = await lockRun(w, input.runId);
    // Sent again after a lost answer: it already waits on this request.
    if (run.status === "waiting" && run.pending?.seq === input.seq) {
      return { result: toRunRow(run), undo: null };
    }
    mustRun(run);
    move(run, "waiting");
    const answer = (label: string, approve: boolean) => ({
      label,
      operation: "agent.decide",
      input: { runId: run.id, seq: input.seq, approve },
    });
    // Filed once per event, by its id.
    const { request } = filed(
      await allowed(w.call)(requestOps.file, {
        title: input.title,
        body: input.body,
        source: "agent",
        externalId: `${run.id}:${input.seq}`,
        actions: [answer("Approve", true), answer("Decline", false)],
      }),
    );
    const asked: Pending = {
      requestId: request.id,
      seq: input.seq,
      kind: input.kind,
      ...(input.connectionId ? { connectionId: input.connectionId } : {}),
      ...(input.tool ? { tool: input.tool } : {}),
      ...(input.inputHash ? { inputHash: input.inputHash } : {}),
    };
    const [row] = await w.tx
      .update(agentRuns)
      .set({ status: "waiting", sessionId: input.sessionId, pending: asked })
      .where(eq(agentRuns.id, run.id))
      .returning();
    if (!row) notFound("No run");
    await revokeRunTokens(w.tx, run.id);
    await touchTask(w, run.taskId);
    return { result: toRunRow(row), undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

export const finish = implementOperation(agentOps.finish, {
  async run(w, input, deps) {
    const run = await lockRun(w, input.runId);
    // Sent again after a lost answer.
    if (run.status === "done") return { result: toRunRow(run), undo: null };
    mustRun(run);
    move(run, "done");
    const task = await readTask(w, run.taskId);
    // Through Tasks' own operation, in this transaction; one already completed stays as it is.
    if (task && task.completedAt === null) {
      await allowed(w.call)(taskOps.complete, {
        id: task.id,
        expectedUpdatedAt: task.updatedAt,
      });
    }
    const [row] = await w.tx
      .update(agentRuns)
      .set({ status: "done", report: input.report, finishedAt: deps.now() })
      .where(eq(agentRuns.id, run.id))
      .returning();
    if (!row) notFound("No run");
    await revokeRunTokens(w.tx, run.id);
    await touchTask(w, run.taskId);
    return { result: toRunRow(row), undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

export const fail = implementOperation(agentOps.fail, {
  async run(w, input, deps) {
    const now = deps.now();
    const run = await lockRun(w, input.runId);
    // Sent again after a lost answer: its "Needs you" is filed.
    if (run.status === "failed" && run.pending?.kind === "failure") {
      return { result: toRunRow(run), undo: null };
    }
    mustRun(run);
    const task = await readTask(w, run.taskId);
    // A deleted task needs no "Needs you": its run is cancelled instead.
    const row = task
      ? await failRun(w, run, task, input, now)
      : await cancelRunning(w, run, false, now);
    return { result: toRunRow(row), undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

export const registerConnection = implementOperation(
  agentOps.registerConnection,
  {
    async run(w, input) {
      const [row] = await w.tx
        .insert(agentConnections)
        .values(input)
        .onConflictDoUpdate({
          target: agentConnections.name,
          set: { type: input.type, scopeSummary: input.scopeSummary },
        })
        .returning({ id: agentConnections.id });
      if (!row) throw new Error("connection not written");
      return { result: { id: row.id }, undo: null };
    },
    async undo() {},
    undoRecord: z.null(),
  },
);
