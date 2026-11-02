import {
  type Due,
  describeOperation,
  fields,
  itemTitle,
  type PaletteContext,
  type PaletteRead,
} from "@dlh/core";
import { z } from "zod";
import { parseDue, parseTaskInput } from "./capture";
import {
  addDays,
  dayOfDue,
  dueHeading,
  formatDue,
  isTimeZone,
  todayIn,
  weekStartOf,
} from "./dates";
import { priority, taskRow } from "./schema";

const id = z.uuid();
const expectedUpdatedAt = z.iso.datetime();
const title = itemTitle.describe("Title");
const due = fields.due().describe("Due");
const priorityField = priority.describe("Priority");
const notes = fields.longText().describe("Notes");
const parentId = fields.item(["task"]).describe("Parent task");

/** ⌘K builds versioned inputs from the task on screen; these operations apply only to tasks. */
function onScreen(ctx: PaletteContext): {
  id: string;
  expectedUpdatedAt: string;
} {
  if (!ctx.item) throw new Error("No task on screen");
  return { id: ctx.item.id, expectedUpdatedAt: ctx.item.updatedAt };
}

/** What `readTask` needs of `tasks.get`'s result. */
const taskView = z.object({
  task: taskRow,
  parents: taskRow.shape.parents,
});

/** `tasks.get` for the task on screen, as ⌘K's `load` reads it. */
async function readTask(ctx: PaletteContext, read: PaletteRead) {
  const { id } = onScreen(ctx);
  return taskView.parse(
    await read("tasks.get", { id, timeZone: ctx.timeZone }),
  );
}

const dueText = (d: Due | null) => (d ? formatDue(d) : "no date");

const create = describeOperation({
  id: "tasks.create",
  kind: "mutation",
  label: "New task",
  description:
    "Creates a task with a title, and optionally a due date, priority, notes and a parent task. Use when the person wants to add a to-do.",
  appliesTo: ["*", "none"],
  words: ["add", "todo", "to-do", "remind", "new task"],
  group: "create",
  input: z.object({
    title,
    due: due.optional(),
    priority: priorityField.optional(),
    notes: notes.optional(),
    parentId: parentId.optional(),
  }),
  subject: (input) => input.parentId ?? null,
  effects: ["createItems", "addLinks"],
  summary: (input) =>
    input.due
      ? `New task ${input.title}, ${dueText(input.due)}`
      : `New task ${input.title}`,
  palette: {
    params: z.object({
      title,
      due: due.optional(),
      priority: priorityField.optional(),
      notes: notes.optional(),
    }),
    // Quick add: "Call the bank fri 9am p1". Parts it didn't find stay unset.
    prefill: (ctx) => {
      const parsed = parseTaskInput(ctx.text, ctx);
      return {
        title: parsed.title || undefined,
        due: parsed.due ?? undefined,
        priority: parsed.priority ?? undefined,
      };
    },
    toInput: (_ctx, params) => params,
  },
});

const update = describeOperation({
  id: "tasks.update",
  kind: "mutation",
  label: "Edit task",
  description:
    "Changes the task's title, due date, priority or notes. Use when the person wants to edit several details at once. Not for only moving the due date.",
  appliesTo: ["task"],
  // Not "change" or "notes": those would pull in Rename and Rewrite notes.
  words: [
    "edit",
    "update",
    "details",
    "priority",
    "high priority",
    "medium priority",
    "notes to",
  ],
  input: z.object({
    id,
    expectedUpdatedAt,
    title: title.optional(),
    due: due.nullable().optional(),
    priority: priorityField.optional(),
    notes: notes.nullable().optional(),
  }),
  subject: (input) => input.id,
  effects: ["updateItem"],
  summary: (input) => (input.title ? `Edit task: ${input.title}` : "Edit task"),
  palette: {
    params: z.object({
      title: title.optional(),
      due: due.nullable().optional(),
      priority: priorityField.optional(),
      notes: notes.nullable().optional(),
    }),
    // The form starts from the task's current values.
    load: async (ctx, read) => {
      const { task } = await readTask(ctx, read);
      return {
        title: task.title,
        due: task.due,
        priority: task.priority,
        notes: task.notes,
      };
    },
    review: true,
    toInput: (ctx, params) => ({ ...onScreen(ctx), ...params }),
  },
});

const complete = describeOperation({
  id: "tasks.complete",
  kind: "mutation",
  label: "Complete",
  description:
    "Marks the task done. Use when the person has finished it. Completing a parent leaves its subtasks as they are.",
  appliesTo: ["task"],
  words: [
    "done",
    "finish",
    "complete",
    "tick",
    "check",
    "check off",
    "mark as done",
    "mark done",
  ],
  input: z.object({ id, expectedUpdatedAt }),
  subject: (input) => input.id,
  effects: ["updateItem"],
  summary: () => "Complete",
});

const reopen = describeOperation({
  id: "tasks.reopen",
  kind: "mutation",
  label: "Reopen",
  description:
    "Marks a done task as not done. Use when the person wants to undo finishing it.",
  appliesTo: ["task"],
  words: [
    "reopen",
    "open",
    "undone",
    "uncheck",
    "untick",
    "not done",
    "mark undone",
  ],
  input: z.object({ id, expectedUpdatedAt }),
  subject: (input) => input.id,
  effects: ["updateItem"],
  summary: () => "Reopen",
});

const reschedule = describeOperation({
  id: "tasks.reschedule",
  kind: "mutation",
  label: "Reschedule",
  description:
    "Changes only the due date of the task on screen. Not for other edits.",
  appliesTo: ["task"],
  words: ["reschedule", "move", "postpone", "push", "due", "date"],
  input: z.object({ id, expectedUpdatedAt, due: due.nullable() }),
  subject: (input) => input.id,
  effects: ["updateItem"],
  summary: (input) =>
    input.due ? `Reschedule to ${dueText(input.due)}` : "Clear the due date",
  palette: {
    params: z.object({ due }),
    // "Reschedule friday"; with no date read, ⌘K asks for one.
    prefill: (ctx) => ({ due: parseDue(ctx.text, ctx) ?? undefined }),
    toInput: (ctx, params) => ({ ...onScreen(ctx), due: params.due }),
  },
});

const rescheduleMany = describeOperation({
  id: "tasks.rescheduleMany",
  kind: "mutation",
  label: "Reschedule all",
  description:
    "Moves several tasks to one due date, all or nothing. Backs Reschedule all on Overdue.",
  appliesTo: "none",
  input: z.object({
    items: z.array(z.object({ id, expectedUpdatedAt })).min(1),
    due: due.nullable(),
  }),
  subject: () => null,
  effects: ["updateItem", "writeOtherItems"],
  summary: (input) =>
    `Reschedule ${input.items.length} tasks to ${dueText(input.due)}`,
  // Off for ⌘K and AI: neither can see the task list to pick from yet.
  palette: false,
  ai: false,
});

const reorder = describeOperation({
  id: "tasks.reorder",
  kind: "mutation",
  label: "Move",
  description:
    "Moves the task to the top or bottom of its list. Not for changing its due date.",
  appliesTo: ["task"],
  words: [
    "reorder",
    "top",
    "bottom",
    "to the top",
    "to the bottom",
    "first",
    "bring",
  ],
  input: z.object({
    id,
    expectedUpdatedAt,
    position: z.union([
      z.enum(["top", "bottom"]),
      // Placing after another task is for drag and drop, not ⌘K or AI.
      z.object({ after: z.uuid() }),
    ]),
  }),
  subject: (input) => input.id,
  effects: ["updateItem"],
  summary: (input) =>
    typeof input.position === "string"
      ? `Move to ${input.position}`
      : "Move after another task",
  palette: {
    params: z.object({
      position: z.enum(["top", "bottom"]).describe("Position"),
    }),
    toInput: (ctx, params) => ({ ...onScreen(ctx), position: params.position }),
  },
});

const addParent = describeOperation({
  id: "tasks.addParent",
  kind: "mutation",
  label: "Make subtask of…",
  description:
    "Makes the task a subtask of another task. One level only: a subtask can't have subtasks.",
  appliesTo: ["task"],
  words: ["subtask", "subtask of", "parent", "nest", "under", "child of"],
  input: z.object({ id, parentId }),
  subject: (input) => input.parentId,
  effects: ["addLinks"],
  summary: () => "Make subtask",
});

const removeParent = describeOperation({
  id: "tasks.removeParent",
  kind: "mutation",
  label: "Remove from parent",
  description:
    "Stops the task being a subtask of the given parent task. Not for deleting it.",
  appliesTo: ["task"],
  words: [
    "unnest",
    "detach",
    "remove parent",
    "remove the parent",
    "from its parent",
    "take out",
    "out of",
    "top level",
  ],
  input: z.object({ id, parentId }),
  subject: (input) => input.parentId,
  effects: ["removeLinks"],
  summary: () => "Remove from parent",
  palette: {
    params: z.object({ parentId }),
    // Its one parent runs on ↵; with more (or none) the form searches.
    load: async (ctx, read) => {
      const { parents } = await readTask(ctx, read);
      return parents.length === 1 ? { parentId: parents[0]?.id } : {};
    },
    toInput: (ctx, params) => ({
      id: onScreen(ctx).id,
      parentId: params.parentId,
    }),
  },
});

const timeZone = z
  .string()
  .refine(isTimeZone, "Unknown time zone")
  .describe("IANA time zone of the device");
const day = z.iso.date();

/**
 * "this week", "next week", or the day of the first date in the text ("friday",
 * "next tue"), as a half-open range of days.
 */
function rangeFrom(ctx: PaletteContext): { from: string; to: string } | null {
  const today = todayIn(ctx.now, ctx.timeZone);
  const week = /\b(this|next) week\b/i.exec(ctx.text);
  if (week) {
    const from = addDays(
      weekStartOf(today),
      week[1]?.toLowerCase() === "next" ? 7 : 0,
    );
    return { from, to: addDays(from, 7) };
  }
  const from = dayOfDue(parseDue(ctx.text, ctx), ctx.timeZone);
  return from ? { from, to: addDays(from, 1) } : null;
}

const dueQuery = describeOperation({
  id: "tasks.due",
  kind: "query",
  label: "Due",
  description:
    "Lists tasks due on a day or in a range of days. `to` is the day after the last one: Friday alone is from Friday to Saturday. Open tasks only unless include is all.",
  appliesTo: ["*", "none"],
  words: ["due", "what's due", "agenda", "deadline"],
  input: z.object({
    from: day.describe("First day"),
    to: day.describe("Day after the last day"),
    timeZone,
    include: z
      .enum(["open", "all"])
      .optional()
      .describe("Open tasks only (the default), or done ones too"),
  }),
  subject: () => null,
  effects: [],
  summary: (input) => dueHeading(input.from, input.to),
  // "due friday", "due this week"; nothing until a date is read.
  palette: (ctx) => {
    const range = rangeFrom(ctx);
    return range ? { ...range, timeZone: ctx.timeZone } : null;
  },
});

const list = describeOperation({
  id: "tasks.list",
  kind: "query",
  label: "Tasks",
  description:
    "Rows for the Open, Upcoming (the week of `weekOf`, and later) and Done (paged by `cursor`) screens.",
  appliesTo: "none",
  input: z.object({
    view: z.enum(["open", "upcoming", "done"]),
    timeZone,
    /** Upcoming only: any day of the week to show. */
    weekOf: day.optional(),
    /** Done only: `nextCursor` from the previous page. */
    cursor: z.string().optional(),
  }),
  subject: () => null,
  effects: [],
  summary: (input) => `Tasks: ${input.view}`,
  palette: false,
  ai: false,
});

const get = describeOperation({
  id: "tasks.get",
  kind: "query",
  label: "Task",
  description: "A task with its subtasks and parents, for the detail panel.",
  appliesTo: ["task"],
  input: z.object({
    id,
    /** For each row's `day`; without it, the zone the due was set in, or UTC. */
    timeZone: timeZone.optional(),
  }),
  subject: (input) => input.id,
  effects: [],
  summary: () => "Task",
  palette: false,
  ai: false,
});

const stats = describeOperation({
  id: "tasks.stats",
  kind: "query",
  label: "Task stats",
  description:
    "Completions per day of the week holding `weekOf`, on time, overdue cleared, and last week's total.",
  appliesTo: "none",
  input: z.object({ timeZone, weekOf: day }),
  subject: () => null,
  effects: [],
  summary: () => "Task stats",
  palette: false,
  ai: false,
});

export const taskOps = {
  create,
  update,
  complete,
  reopen,
  reschedule,
  rescheduleMany,
  reorder,
  addParent,
  removeParent,
  due: dueQuery,
  list,
  get,
  stats,
};
