import { type Item, item as itemSchema } from "@dlh/core";
import { taskOps } from "@dlh/module-tasks/operations";
import {
  type CoreDeps,
  getItem,
  implementOperation,
  type ScopedWriter,
  type Tx,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requests } from "../db/schema";
import { requestOps } from "../operations";
import {
  type Outcome,
  outcome,
  type RequestAction,
  type RequestRow,
  requestAction,
  source,
} from "../schema";
import { anyItem, liveType, requestTask } from "./links";

type RequestTableRow = typeof requests.$inferSelect;

function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function notFound(message = "request not found"): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}

function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}

/** A writer method the operation's effects allow; absent only if the effects are wrong. */
function allowed<T>(method: T | undefined): T {
  if (!method) throw new Error("Write outside the operation's effects");
  return method;
}

/** The request as the API returns it: its item and its row. */
export function toRequestRow(item: Item, row: RequestTableRow): RequestRow {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    archivedAt: item.archivedAt,
    updatedAt: item.updatedAt,
    body: row.body,
    fromName: row.fromName,
    fromOwner: row.fromOwner,
    source: source.parse(row.source),
    sourceHandle: row.sourceHandle,
    sourceUrl: row.sourceUrl,
    externalId: row.externalId,
    receivedAt: row.receivedAt.toISOString(),
    actions:
      row.actions === null ? null : z.array(requestAction).parse(row.actions),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    outcome: row.outcome === null ? null : outcome.parse(row.outcome),
  };
}

/** What Core search reads for a request: its body and who it is from. */
function searchTextOf(body: string | null, fromName: string | null) {
  return [body, fromName].filter(Boolean).join("\n") || null;
}

/**
 * Locks the request's row. Every write to a request takes this lock before it
 * writes the request's item, so two writes on one request queue rather than
 * deadlock.
 */
async function lockRequest(tx: Tx, id: string): Promise<RequestTableRow> {
  const [row] = await tx
    .select()
    .from(requests)
    .where(eq(requests.itemId, id))
    .for("update");
  if (!row) notFound();
  return row;
}

/**
 * The live request, read after locking its row: a write that overlaps another
 * on the same request waits for it and then reads what it committed. So a
 * second Handled sees the request handled and is a no-op, not a conflict.
 */
async function loadRequest(
  tx: Tx,
  id: string,
): Promise<{ item: Item; row: RequestTableRow }> {
  const row = await lockRequest(tx, id);
  const item = await getItem(tx, id);
  return { item, row };
}

/**
 * Writes the request's item (so `updated_at` moves and a change is published)
 * under its version check, then sets the outcome, resolved at `resolvedAt`;
 * `null` reopens it.
 */
async function setOutcome(
  w: ScopedWriter,
  target: { id: string; expectedUpdatedAt: string },
  to: Outcome | null,
  resolvedAt: Date,
): Promise<RequestRow> {
  // Only the version: makeTask's `title` names the task, not the request.
  const item = await allowed(w.updateItem)({
    id: target.id,
    expectedUpdatedAt: target.expectedUpdatedAt,
  });
  const [row] = await w.tx
    .update(requests)
    .set({ outcome: to, resolvedAt: to === null ? null : resolvedAt })
    .where(eq(requests.itemId, target.id))
    .returning();
  if (!row) notFound();
  return toRequestRow(item, row);
}

/** Links the request to its task as the outcome; a link already there keeps its context. */
async function linkOutcome(w: ScopedWriter, requestId: string, taskId: string) {
  await allowed(w.addLink)({
    fromId: requestId,
    toId: taskId,
    kind: "relates",
    context: "outcome",
  });
}

/**
 * Clears the outcome (`was`, the outcome it had) and removes the outcome link,
 * if any. A link the person added by hand stays. Returns the request's task.
 */
async function reopenRequest(
  w: ScopedWriter,
  target: { id: string; expectedUpdatedAt: string },
  was: Outcome | null,
  now: Date,
): Promise<{ request: RequestRow; taskId: string | null }> {
  const found = await requestTask(w.tx, target.id, was);
  const request = await setOutcome(w, target, null, now);
  if (found?.isOutcomeLink) await allowed(w.removeLink)(found.linkId);
  return { request, taskId: found?.taskId ?? null };
}

/** Reopens request `id` if it is still at `updatedAt`, else Core reports "Changed since". */
const reopenRecord = z.object({ id: z.uuid(), updatedAt: z.string() });
type ReopenRecord = z.infer<typeof reopenRecord>;

async function undoByReopening(
  w: ScopedWriter,
  r: ReopenRecord | null,
  deps: CoreDeps,
): Promise<void> {
  if (!r) return;
  await lockRequest(w.tx, r.id);
  await reopenRequest(
    w,
    { id: r.id, expectedUpdatedAt: r.updatedAt },
    null,
    deps.now(),
  );
}

/**
 * Each action's operation must be a registered mutation that resolves this
 * request through an operation call.
 */
function checkActions(deps: CoreDeps, actions: RequestAction[]): void {
  for (const a of actions) {
    const op = deps.operations.get(a.operation);
    const resolves =
      op?.kind === "mutation" &&
      (op.desc.calls ?? []).some((c) => c.id === requestOps.resolve.id);
    if (!resolves) {
      badRequest(
        `Action "${a.label}": ${a.operation} is not an operation that resolves a request`,
      );
    }
  }
}

/** The request filed earlier with this pair, deleted or not. */
async function filedAs(
  tx: Tx,
  src: string,
  externalId: string,
): Promise<RequestRow | null> {
  // Two filings of one pair queue here; the second then reads the first's row.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtext(${src} || ':' || ${externalId}))`,
  );
  const [row] = await tx
    .select()
    .from(requests)
    .where(and(eq(requests.source, src), eq(requests.externalId, externalId)));
  if (!row) return null;
  const item = await anyItem(tx, row.itemId);
  if (!item) return null;
  return toRequestRow(item, row);
}

export const file = implementOperation(requestOps.file, {
  async run(w, input, deps) {
    // Actions run operations from a Queue button, so only an operation (the
    // agent's suspend or fail) may attach them, never a person or a run token.
    if (input.actions && !w.viaCall) {
      badRequest("Only an operation call may file with actions");
    }
    const src = input.source ?? "ai";
    if (input.externalId !== undefined) {
      const existing = await filedAs(w.tx, src, input.externalId);
      if (existing) {
        return { result: { request: existing, existing: true }, undo: null };
      }
    }
    if (input.actions) checkActions(deps, input.actions);
    const body = input.body || null;
    const fromName = input.fromName ?? null;
    const item = await allowed(w.createItem)({
      type: "request",
      title: input.title,
      searchText: searchTextOf(body, fromName),
    });
    const [row] = await w.tx
      .insert(requests)
      .values({
        itemId: item.id,
        body,
        fromName,
        fromOwner: input.fromOwner ?? false,
        source: src,
        sourceHandle: input.sourceHandle ?? null,
        sourceUrl: input.sourceUrl ?? null,
        externalId: input.externalId ?? null,
        receivedAt: input.receivedAt ? new Date(input.receivedAt) : deps.now(),
        actions: input.actions ?? null,
      })
      .returning();
    if (!row) throw new Error("request row not written");
    return {
      result: { request: toRequestRow(item, row), existing: false },
      undo: null,
    };
  },
  // Core soft-deletes the created request; a refiling finds it and writes nothing.
  async undo() {},
  undoRecord: z.null(),
});

export const resolve = implementOperation(requestOps.resolve, {
  async run(w, input, deps) {
    const { item, row } = await loadRequest(w.tx, input.id);
    if (row.outcome !== null) {
      if (row.outcome !== input.outcome) conflict("Already resolved");
      if (input.taskId !== undefined) {
        const found = await requestTask(w.tx, input.id, row.outcome);
        if (found?.taskId !== input.taskId) {
          conflict("Already resolved as another task");
        }
      }
      // Pressed twice, or on two devices: nothing to write, whatever the version.
      return { result: toRequestRow(item, row), undo: null };
    }
    if (input.taskId !== undefined) {
      const type = await liveType(w.tx, input.taskId);
      if (type === null) notFound("task not found");
      if (type !== "task") badRequest("taskId must be a task");
    }
    const request = await setOutcome(w, input, input.outcome, deps.now());
    if (input.taskId !== undefined) {
      await linkOutcome(w, input.id, input.taskId);
    }
    return {
      result: request,
      undo: { id: request.id, updatedAt: request.updatedAt },
    };
  },
  undo: undoByReopening,
  undoRecord: reopenRecord.nullable(),
});

export const makeTask = implementOperation(requestOps.makeTask, {
  async run(w, input, deps) {
    const { item, row } = await loadRequest(w.tx, input.id);
    if (row.outcome !== null) conflict("Already resolved");
    const call = allowed(w.call);
    // Through Tasks' own operation, so its rules apply (an invalid due is refused).
    const task = itemSchema.parse(
      await call(taskOps.create, {
        title: input.title ?? item.title,
        due: input.due,
        priority: input.priority,
        // Notes "" (cleared in the form) stays "": Tasks keeps it as no notes.
        notes: input.notes ?? row.body ?? undefined,
      }),
    );
    const request = await setOutcome(w, input, "task", deps.now());
    await linkOutcome(w, input.id, task.id);
    return {
      result: { request, task },
      undo: { id: request.id, updatedAt: request.updatedAt },
    };
  },
  // Core soft-deletes the task after this reopens the request, even if it was edited since.
  undo: undoByReopening,
  undoRecord: reopenRecord,
});

/**
 * Resolves request `id` again as it was (outcome and time), if it is still at
 * `updatedAt`, and relinks a live task.
 */
const resolveAgainRecord = z.object({
  id: z.uuid(),
  updatedAt: z.string(),
  outcome,
  resolvedAt: z.iso.datetime(),
  taskId: z.uuid().nullable(),
});

export const reopen = implementOperation(requestOps.reopen, {
  async run(w, input, deps) {
    const { row } = await loadRequest(w.tx, input.id);
    const was = row.outcome === null ? null : outcome.parse(row.outcome);
    // A state conflict like "Already resolved": ⌘K shows the message, and a
    // screen that still showed it resolved refetches.
    if (was === null || row.resolvedAt === null) conflict("Not resolved");
    const { request, taskId } = await reopenRequest(w, input, was, deps.now());
    return {
      result: request,
      undo: {
        id: request.id,
        updatedAt: request.updatedAt,
        outcome: was,
        resolvedAt: row.resolvedAt.toISOString(),
        taskId,
      },
    };
  },
  async undo(w, r) {
    await lockRequest(w.tx, r.id);
    await setOutcome(
      w,
      { id: r.id, expectedUpdatedAt: r.updatedAt },
      r.outcome,
      new Date(r.resolvedAt),
    );
    if (r.taskId && (await liveType(w.tx, r.taskId)) === "task") {
      await linkOutcome(w, r.id, r.taskId);
    }
  },
  undoRecord: resolveAgainRecord,
});

/** What `append` changed, to put back: the item at `updatedAt`, with its old text. */
const appendRecord = z.object({
  id: z.uuid(),
  updatedAt: z.string(),
  body: z.string().nullable(),
  fromName: z.string().nullable(),
  appendedIds: z.array(z.string()),
});

export const append = implementOperation(requestOps.append, {
  async run(w, input) {
    const { item, row } = await loadRequest(w.tx, input.id);
    if (row.outcome !== null) conflict("Already resolved");
    // A redelivered message: nothing to write, so the version stays.
    if (row.appendedIds.includes(input.key)) {
      return { result: { appended: false }, undo: null };
    }
    const body = row.body ? `${row.body}\n\n${input.text}` : input.text;
    const appendedIds = [...row.appendedIds, input.key];
    const written = await allowed(w.updateItem)({
      id: input.id,
      expectedUpdatedAt: item.updatedAt,
      searchText: searchTextOf(body, row.fromName),
    });
    await w.tx
      .update(requests)
      .set({ body, appendedIds })
      .where(eq(requests.itemId, input.id));
    return {
      result: { appended: true },
      undo: {
        id: input.id,
        updatedAt: written.updatedAt,
        body: row.body,
        fromName: row.fromName,
        appendedIds: row.appendedIds,
      },
    };
  },
  async undo(w, r) {
    if (!r) return;
    await lockRequest(w.tx, r.id);
    await allowed(w.updateItem)({
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
      searchText: searchTextOf(r.body, r.fromName),
    });
    await w.tx
      .update(requests)
      .set({ body: r.body, appendedIds: r.appendedIds })
      .where(eq(requests.itemId, r.id));
  },
  undoRecord: appendRecord.nullable(),
});
