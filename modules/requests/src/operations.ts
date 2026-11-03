import {
  describeOperation,
  fields,
  itemTitle,
  type PaletteContext,
} from "@dlh/core";
import { taskOps } from "@dlh/module-tasks/operations";
import { z } from "zod";
import { fileInput, outcome, requestRow, resolveInput } from "./schema";

const id = z.uuid();
const expectedUpdatedAt = z.iso.datetime();

/** ⌘K builds versioned inputs from the request on screen. */
function onScreen(ctx: PaletteContext): {
  id: string;
  expectedUpdatedAt: string;
} {
  if (!ctx.item) throw new Error("No request on screen");
  return { id: ctx.item.id, expectedUpdatedAt: ctx.item.updatedAt };
}

/** The outcome named in typed text ("handled", "not for me"), if any. */
function outcomeIn(text: string): "handled" | "not_for_me" | undefined {
  const t = text.toLowerCase();
  if (/\b(not for me|ignore)\b/.test(t)) return "not_for_me";
  if (/\b(handled|done)\b/.test(t)) return "handled";
  return undefined;
}

const file = describeOperation({
  id: "requests.file",
  kind: "mutation",
  label: "File a request",
  description:
    "Files something that needs the person into their queue, to review once later: a message, an ask, or a reminder to look at something. Not for a to-do with a date: that is a task.",
  appliesTo: ["*", "none"],
  words: ["file", "file this", "remind me to look at"],
  group: "create",
  input: fileInput,
  subject: () => null,
  effects: ["createItems"],
  summary: (input) => `File a request: ${input.title}`,
  palette: {
    params: z.object({
      title: itemTitle.describe("Title"),
      body: fields.longText().optional().describe("Details"),
      fromName: z.string().optional().describe("From"),
    }),
    prefill: (ctx) => ({ title: ctx.text.trim() || undefined }),
    // An empty form field is no value.
    toInput: (_ctx, params) => ({
      title: params.title,
      body: params.body || undefined,
      fromName: params.fromName?.trim() || undefined,
      source: "manual" as const,
    }),
  },
});

const resolve = describeOperation({
  id: "requests.resolve",
  kind: "mutation",
  label: "Resolve request",
  description:
    "Resolves the request on screen as handled (the person dealt with it) or not for me (it wasn't theirs to do), or as a task that already exists. Use Make task to make a new task from it.",
  appliesTo: ["request"],
  words: ["handled", "done with this", "not for me", "ignore this"],
  input: resolveInput,
  subject: (input) => input.id,
  effects: ["updateItem", "addLinks"],
  summary: (input) =>
    input.outcome === "handled"
      ? "Handled"
      : input.outcome === "not_for_me"
        ? "Not for me"
        : "Resolve as a task",
  palette: {
    params: z.object({
      outcome: z.enum(["handled", "not_for_me"]).describe("Outcome"),
    }),
    // ⌘K takes the word it matched ("not for me") out of the text.
    prefill: (ctx) => ({
      outcome: outcomeIn(ctx.name ?? "") ?? outcomeIn(ctx.text),
    }),
    toInput: (ctx, params) => ({ ...onScreen(ctx), outcome: params.outcome }),
  },
});

const taskFields = taskOps.create.input.shape;

/** What ⌘K's `load` needs of `requests.get`'s result. */
const requestView = z.object({ request: requestRow });

const makeTask = describeOperation({
  id: "requests.makeTask",
  kind: "mutation",
  label: "Make task",
  description:
    "Makes a new task from the request on screen and resolves the request as a task. The title defaults to the request's and the notes to its details.",
  appliesTo: ["request"],
  words: ["make a task", "make task", "task from this", "turn into a task"],
  input: z.object({
    id,
    expectedUpdatedAt,
    title: taskFields.title.optional(),
    due: taskFields.due.optional(),
    priority: taskFields.priority.optional(),
    notes: taskFields.notes.optional(),
  }),
  subject: (input) => input.id,
  effects: ["updateItem", "addLinks"],
  summary: (input) => (input.title ? `Make task: ${input.title}` : "Make task"),
  calls: [taskOps.create],
  palette: {
    params: z.object({
      title: taskFields.title.optional(),
      due: taskFields.due.optional(),
      priority: taskFields.priority.optional(),
      notes: taskFields.notes.optional(),
    }),
    // The form starts from the request: its title, and its details as notes.
    load: async (ctx, read) => {
      const { request } = requestView.parse(
        await read("requests.get", { id: onScreen(ctx).id }),
      );
      return { title: request.title, notes: request.body ?? undefined };
    },
    review: true,
    toInput: (ctx, params) => ({ ...onScreen(ctx), ...params }),
  },
});

const reopen = describeOperation({
  id: "requests.reopen",
  kind: "mutation",
  label: "Reopen",
  description:
    "Puts a resolved request back in the queue. A task made from it stays.",
  appliesTo: ["request"],
  words: ["reopen", "back to the queue"],
  input: z.object({ id, expectedUpdatedAt }),
  subject: (input) => input.id,
  effects: ["updateItem", "removeLinks"],
  summary: () => "Reopen",
  // Runs on ↵ for the request on screen.
  palette: (ctx) => (ctx.item?.type === "request" ? onScreen(ctx) : null),
  ai: false,
});

const open = describeOperation({
  id: "requests.open",
  kind: "query",
  label: "Waiting on me",
  description:
    "The requests waiting on the person, oldest first: what is in their queue and not yet resolved.",
  appliesTo: ["*", "none"],
  words: ["waiting on me", "waiting for me", "queue", "requests", "needs me"],
  input: z.object({}),
  subject: () => null,
  effects: [],
  summary: () => "Waiting on me",
});

const resolved = describeOperation({
  id: "requests.resolved",
  kind: "query",
  label: "Resolved requests",
  description:
    "Requests resolved in the last 30 days, newest first, 50 a page, optionally of one outcome.",
  appliesTo: "none",
  input: z.object({
    outcome: outcome.optional(),
    cursor: z.string().optional(),
  }),
  subject: () => null,
  effects: [],
  summary: () => "Resolved requests",
  palette: false,
  ai: false,
});

const get = describeOperation({
  id: "requests.get",
  kind: "query",
  label: "Request",
  description:
    "A request with the task it was resolved as, if any, for the detail panel.",
  appliesTo: ["request"],
  input: z.object({ id }),
  subject: (input) => input.id,
  effects: [],
  summary: () => "Request",
  palette: false,
  ai: false,
});

export const requestOps = {
  file,
  resolve,
  makeTask,
  reopen,
  open,
  resolved,
  get,
};
