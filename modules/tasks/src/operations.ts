import {
  type Due,
  describeOperation,
  fields,
  itemTitle,
  type PaletteContext,
} from "@dlh/core";
import { z } from "zod";
import { parseDue, parseTaskInput } from "./capture";
import { formatDue } from "./dates";
import { priority } from "./schema";

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

const dueText = (d: Due | null) => (d ? formatDue(d) : "no date");

const create = describeOperation({
  id: "tasks.create",
  kind: "mutation",
  label: "New task",
  description:
    "Creates a task with a title, and optionally a due date, priority, notes and a parent task. Use when the person wants to add a to-do.",
  appliesTo: ["*", "none"],
  words: ["add", "todo", "to-do", "remind"],
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
  words: ["edit", "change", "set priority", "notes"],
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
});

const complete = describeOperation({
  id: "tasks.complete",
  kind: "mutation",
  label: "Complete",
  description:
    "Marks the task done. Use when the person has finished it. Completing a parent leaves its subtasks as they are.",
  appliesTo: ["task"],
  words: ["done", "finish", "tick", "check off"],
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
  words: ["undone", "uncheck", "not done"],
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
  words: ["move", "postpone", "push", "due"],
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
  words: ["top", "bottom", "reorder"],
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
  words: ["subtask", "parent", "nest", "under"],
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
  words: ["unnest", "detach", "remove parent"],
  input: z.object({ id, parentId }),
  subject: (input) => input.parentId,
  effects: ["removeLinks"],
  summary: () => "Remove from parent",
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
};
