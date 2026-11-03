import type { Due, Item } from "@dlh/core";
import {
  getItem,
  type ItemWriter,
  implementOperation,
  type ScopedWriter,
  type Tx,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { and, eq, ne, sql } from "drizzle-orm";
import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";
import { tasks } from "../db/schema";
import { taskOps } from "../operations";
import { priority } from "../schema";
import {
  containsLinkId,
  hasTaskParent,
  hasTaskSubtasks,
  linkExists,
  liveType,
  parentsNowDone,
} from "./links";

type TaskTableRow = typeof tasks.$inferSelect;
type TaskChanges = Partial<Omit<TaskTableRow, "itemId">>;

// Sort keys are fractional-indexing keys, which order by byte. The column is
// already collated "C"; saying so here keeps these comparisons right on their own.
const sortKeyC = sql`${tasks.sortKey} collate "C"`;

function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

function notFound(message = "task not found"): never {
  throw new TRPCError({ code: "NOT_FOUND", message });
}

/** A writer method the operation's effects allow; absent only if the effects are wrong. */
function allowed<T>(method: T | undefined): T {
  if (!method) throw new Error("Write outside the operation's effects");
  return method;
}

/** Notes as stored: empty notes are no notes. */
function notesValue(notes: string | null | undefined): string | null {
  return notes ? notes : null;
}

/** A `Due` as the three due columns. */
export function dueColumns(
  due: Due | null,
): Pick<TaskTableRow, "dueDate" | "dueAt" | "dueTz"> {
  if (!due) return { dueDate: null, dueAt: null, dueTz: null };
  if ("date" in due) return { dueDate: due.date, dueAt: null, dueTz: null };
  return {
    dueDate: null,
    dueAt: new Date(due.dateTime),
    dueTz: due.timeZone ?? null,
  };
}

/** A key after every task's, so a new task goes at the end. */
async function lastKey(tx: Tx): Promise<string> {
  const [row] = await tx
    .select({ max: sql<string | null>`max(${sortKeyC})` })
    .from(tasks);
  return generateKeyBetween(row?.max ?? null, null);
}

/** Writes a new task's row; the item is already created. */
export async function insertTaskRow(
  tx: Tx,
  itemId: string,
  t: { due?: Due | null; priority?: string; notes?: string | null },
): Promise<void> {
  await tx.insert(tasks).values({
    itemId,
    ...dueColumns(t.due ?? null),
    priority: t.priority ?? "medium",
    notes: notesValue(t.notes),
    sortKey: await lastKey(tx),
  });
}

/** Creates a task item and its row, for `create` and the seed. */
export async function createTask(
  w: Pick<ItemWriter, "tx" | "createItem">,
  t: {
    title: string;
    due?: Due | null;
    priority?: string;
    notes?: string | null;
  },
): Promise<Item> {
  const item = await w.createItem({
    type: "task",
    title: t.title,
    searchText: notesValue(t.notes),
  });
  await insertTaskRow(w.tx, item.id, t);
  return item;
}

/**
 * The task, read after locking its row: a write that overlaps another on the
 * same task waits for it and then reads what it committed. So a second
 * complete sees the task done and is a no-op instead of a version conflict.
 */
async function loadTask(
  tx: Tx,
  id: string,
): Promise<{ item: Item; row: TaskTableRow }> {
  const [row] = await tx
    .select()
    .from(tasks)
    .where(eq(tasks.itemId, id))
    .for("update");
  if (!row) notFound();
  const item = await getItem(tx, id);
  return { item, row };
}

/** What a write can change on a task, to put back on undo. */
const taskState = z.object({
  title: z.string(),
  completedAt: z.string().nullable(),
  dueDate: z.string().nullable(),
  dueAt: z.string().nullable(),
  dueTz: z.string().nullable(),
  priority,
  notes: z.string().nullable(),
  sortKey: z.string(),
});
type TaskState = z.infer<typeof taskState>;

/** Puts task `id` back to `before`, if it is still at `updatedAt`. */
const restoreRecord = z.object({
  id: z.uuid(),
  updatedAt: z.string(),
  before: taskState,
});
type RestoreRecord = z.infer<typeof restoreRecord>;

function stateOf(item: Item, row: TaskTableRow): TaskState {
  return {
    title: item.title,
    completedAt: row.completedAt?.toISOString() ?? null,
    dueDate: row.dueDate,
    dueAt: row.dueAt?.toISOString() ?? null,
    dueTz: row.dueTz,
    priority: priority.parse(row.priority),
    notes: row.notes,
    sortKey: row.sortKey,
  };
}

/**
 * Writes the task's item (`updated_at` moves even with no item fields, so other
 * devices refresh) and then its row, under the item's version check.
 */
async function writeTask(
  w: ScopedWriter,
  target: { id: string; expectedUpdatedAt: string },
  set: TaskChanges,
  itemFields: { title?: string; searchText?: string | null } = {},
): Promise<Item> {
  const item = await allowed(w.updateItem)({ ...target, ...itemFields });
  if (Object.keys(set).length > 0) {
    await w.tx.update(tasks).set(set).where(eq(tasks.itemId, target.id));
  }
  return item;
}

/** Loads the task, writes `set`, and returns the item with a record to undo it. */
async function changeTask(
  w: ScopedWriter,
  target: { id: string; expectedUpdatedAt: string },
  set: TaskChanges,
  itemFields: { title?: string; searchText?: string | null } = {},
): Promise<{ item: Item; record: RestoreRecord }> {
  const before = await loadTask(w.tx, target.id);
  const item = await writeTask(w, target, set, itemFields);
  return {
    item,
    record: {
      id: item.id,
      updatedAt: item.updatedAt,
      before: stateOf(before.item, before.row),
    },
  };
}

async function restore(w: ScopedWriter, r: RestoreRecord): Promise<void> {
  const s = r.before;
  await writeTask(
    w,
    { id: r.id, expectedUpdatedAt: r.updatedAt },
    {
      completedAt: s.completedAt ? new Date(s.completedAt) : null,
      dueDate: s.dueDate,
      dueAt: s.dueAt ? new Date(s.dueAt) : null,
      dueTz: s.dueTz,
      priority: s.priority,
      notes: s.notes,
      sortKey: s.sortKey,
    },
    { title: s.title, searchText: s.notes },
  );
}

/**
 * Checks the one-level subtask rules and links `parentId` → `id`. `added` is
 * false when the link was already there.
 */
async function linkParent(
  w: ScopedWriter,
  parentId: string,
  id: string,
  { newChild }: { newChild: boolean },
) {
  const tx = w.tx;
  const parentType = await liveType(tx, parentId);
  if (parentType === null) notFound("parent not found");
  if (parentType !== "task") badRequest("A task's parent must be a task");
  if (await hasTaskParent(tx, parentId)) {
    badRequest("A subtask can't have subtasks");
  }
  if (!newChild) {
    const childType = await liveType(tx, id);
    if (childType === null) notFound();
    if (childType !== "task") badRequest("Only a task can be a subtask");
    if (await hasTaskSubtasks(tx, id)) {
      badRequest("A task with subtasks can't be a subtask");
    }
  }
  const existing = await containsLinkId(tx, parentId, id);
  const link = await allowed(w.addLink)({
    fromId: parentId,
    toId: id,
    kind: "contains",
  });
  return { link, added: existing === null };
}

async function sortKeyOf(tx: Tx, id: string): Promise<string> {
  const [row] = await tx
    .select({ sortKey: tasks.sortKey })
    .from(tasks)
    .where(eq(tasks.itemId, id));
  if (!row || (await liveType(tx, id)) === null) notFound();
  return row.sortKey;
}

/** The sort key that puts task `id` at `position`, ignoring its current key. */
async function keyAt(
  tx: Tx,
  id: string,
  position: "top" | "bottom" | { after: string },
): Promise<string> {
  const others = ne(tasks.itemId, id);
  if (position === "top" || position === "bottom") {
    const edge = position === "top" ? sql`min` : sql`max`;
    const [row] = await tx
      .select({ key: sql<string | null>`${edge}(${sortKeyC})` })
      .from(tasks)
      .where(others);
    const key = row?.key ?? null;
    return position === "top"
      ? generateKeyBetween(null, key)
      : generateKeyBetween(key, null);
  }
  if (position.after === id) badRequest("A task can't move after itself");
  const after = await sortKeyOf(tx, position.after);
  const [next] = await tx
    .select({ key: sql<string | null>`min(${sortKeyC})` })
    .from(tasks)
    .where(and(others, sql`${sortKeyC} > ${after}`));
  return generateKeyBetween(after, next?.key ?? null);
}

export const create = implementOperation(taskOps.create, {
  async run(w, input) {
    const item = await createTask(
      { tx: w.tx, createItem: allowed(w.createItem) },
      input,
    );
    if (input.parentId) {
      await linkParent(w, input.parentId, item.id, { newChild: true });
    }
    return { result: item, undo: null };
  },
  // Core soft-deletes the created task; links to a deleted item are hidden.
  async undo() {},
  undoRecord: z.null(),
});

export const update = implementOperation(taskOps.update, {
  async run(w, input) {
    const { id, expectedUpdatedAt, title, due, notes } = input;
    const set: TaskChanges = {};
    if (due !== undefined) Object.assign(set, dueColumns(due));
    if (input.priority !== undefined) set.priority = input.priority;
    const itemFields: { title?: string; searchText?: string | null } = {};
    if (title !== undefined) itemFields.title = title;
    if (notes !== undefined) {
      set.notes = notesValue(notes);
      itemFields.searchText = set.notes;
    }
    const { item, record } = await changeTask(
      w,
      { id, expectedUpdatedAt },
      set,
      itemFields,
    );
    return { result: item, undo: record };
  },
  undo: restore,
  undoRecord: restoreRecord,
});

/**
 * Sets `completed_at`. Completing a done task, or reopening an open one, changes
 * nothing and writes nothing, whatever version the caller had.
 */
async function setCompleted(
  w: ScopedWriter,
  input: { id: string; expectedUpdatedAt: string },
  completedAt: Date | null,
): Promise<{ item: Item; record: RestoreRecord | null }> {
  const { item, row } = await loadTask(w.tx, input.id);
  if ((row.completedAt === null) === (completedAt === null)) {
    return { item, record: null };
  }
  return changeTask(w, input, { completedAt });
}

async function undoIfWritten(
  w: ScopedWriter,
  record: RestoreRecord | null,
): Promise<void> {
  if (record) await restore(w, record);
}

export const complete = implementOperation(taskOps.complete, {
  async run(w, input, deps) {
    const { item, record } = await setCompleted(w, input, deps.now());
    const done = record ? await parentsNowDone(w.tx, input.id) : [];
    return { result: { task: item, parentsNowDone: done }, undo: record };
  },
  undo: undoIfWritten,
  undoRecord: restoreRecord.nullable(),
});

export const reopen = implementOperation(taskOps.reopen, {
  async run(w, input) {
    const { item, record } = await setCompleted(w, input, null);
    return { result: item, undo: record };
  },
  undo: undoIfWritten,
  undoRecord: restoreRecord.nullable(),
});

export const reschedule = implementOperation(taskOps.reschedule, {
  async run(w, input) {
    const { item, record } = await changeTask(w, input, dueColumns(input.due));
    return { result: item, undo: record };
  },
  undo: restore,
  undoRecord: restoreRecord,
});

export const rescheduleMany = implementOperation(taskOps.rescheduleMany, {
  async run(w, input) {
    const set = dueColumns(input.due);
    const result: Item[] = [];
    const undo: RestoreRecord[] = [];
    // One transaction: a stale version anywhere fails the whole batch.
    for (const target of input.items) {
      const { item, record } = await changeTask(w, target, set);
      result.push(item);
      undo.push(record);
    }
    return { result, undo };
  },
  async undo(w, records) {
    for (const r of records) await restore(w, r);
  },
  undoRecord: z.array(restoreRecord),
});

export const reorder = implementOperation(taskOps.reorder, {
  async run(w, input) {
    const sortKey = await keyAt(w.tx, input.id, input.position);
    const { item, record } = await changeTask(w, input, { sortKey });
    return { result: item, undo: record };
  },
  undo: restore,
  undoRecord: restoreRecord,
});

export const addParent = implementOperation(taskOps.addParent, {
  async run(w, input) {
    const { link, added } = await linkParent(w, input.parentId, input.id, {
      newChild: false,
    });
    // Already its parent: nothing changed, so nothing to undo.
    return { result: link, undo: added ? { linkId: link.id } : null };
  },
  async undo(w, record) {
    if (record?.linkId && (await linkExists(w.tx, record.linkId))) {
      await allowed(w.removeLink)(record.linkId);
    }
  },
  // A null linkId is a no-op record from before null meant "nothing to undo".
  undoRecord: z.object({ linkId: z.uuid().nullable() }).nullable(),
});

export const removeParent = implementOperation(taskOps.removeParent, {
  async run(w, input) {
    const linkId =
      (await liveType(w.tx, input.parentId)) === "task"
        ? await containsLinkId(w.tx, input.parentId, input.id)
        : null;
    if (!linkId) badRequest("That task isn't a parent of this one");
    await allowed(w.removeLink)(linkId);
    return { result: null, undo: { id: input.id, parentId: input.parentId } };
  },
  async undo(w, record) {
    // The same rules as adding it: since the removal either side may have
    // gained a parent or a subtask.
    await linkParent(w, record.parentId, record.id, { newChild: false });
  },
  undoRecord: z.object({ id: z.uuid(), parentId: z.uuid() }),
});
