import {
  askerInput,
  describeOperation,
  fields,
  itemOnScreen,
  itemTitle,
} from "@dlh/core";
import { taskOps } from "@dlh/module-tasks/operations";
import { z } from "zod";
import { fileInput, outcome, requestRow, resolveInput } from "./schema";

const id = z.uuid();
const expectedUpdatedAt = z.iso.datetime();

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
  words: ["file", "file this", "remind me to look at", "to my queue"],
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
  words: [
    "handled",
    "done with this",
    "not for me",
    "ignore this",
    "ignore",
    "dismiss",
    "mark",
    "resolve",
  ],
  // Handled needs no task: a guessed outcome of task would want a taskId too.
  devFake: { outcome: "handled" },
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
    toInput: (ctx, params) => ({
      ...itemOnScreen(ctx),
      outcome: params.outcome,
    }),
  },
});

const taskFields = taskOps.create.input.shape;

/** Make task's form, in ⌘K and on the Queue screens. */
export const makeTaskParams = z.object({
  title: taskFields.title.optional(),
  due: taskFields.due.optional(),
  priority: taskFields.priority.optional(),
  notes: taskFields.notes.optional(),
});

/** What ⌘K's `load` needs of `requests.get`'s result. */
const requestView = z.object({ request: requestRow });

const makeTask = describeOperation({
  id: "requests.makeTask",
  kind: "mutation",
  label: "Make task",
  description:
    "Makes a new task from the request on screen and resolves the request as a task. The title defaults to the request's and the notes to its details.",
  appliesTo: ["request"],
  words: [
    "make a task",
    "make task",
    "task from this",
    "into a task",
    "a task",
  ],
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
    params: makeTaskParams,
    // The form starts from the request: its title, and its details as notes.
    load: async (ctx, read) => {
      const { request } = requestView.parse(
        await read("requests.get", { id: itemOnScreen(ctx).id }),
      );
      return { title: request.title, notes: request.body ?? undefined };
    },
    review: true,
    toInput: (ctx, params) => ({ ...itemOnScreen(ctx), ...params }),
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
  palette: (ctx) => (ctx.item?.type === "request" ? itemOnScreen(ctx) : null),
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

const append = describeOperation({
  id: "requests.append",
  kind: "mutation",
  label: "Add to request",
  description:
    "Adds a later message to a request's details. Reached only through operation calls (the Slack bot's follow-ups); a key already added is ignored.",
  appliesTo: "none",
  input: z.object({ id, key: z.string().min(1), text: z.string().min(1) }),
  subject: (input) => input.id,
  effects: ["updateItem"],
  summary: () => "Add to request",
  palette: false,
  ai: false,
});

const fromSender = describeOperation({
  id: "requests.fromSender",
  kind: "query",
  label: "Requests from a sender",
  description:
    "One Slack user's own requests, newest first, for answering whether the person saw them.",
  appliesTo: "none",
  // An agent run may call it; the agent module's run guard allows only the
  // run's own asker without an approval.
  audience: "asker",
  access: "everyone",
  input: z.object({
    asker: askerInput,
    openOnly: z.boolean().optional(),
    // A string, not a Date: as a hub tool and AI action its input is JSON Schema.
    since: z.iso.datetime().optional(),
  }),
  subject: () => null,
  effects: [],
  summary: () => "Requests from a sender",
  palette: false,
  // The dev fake can't guess an asker from field names.
  devFake: { asker: { slackUserId: "U_DEV", githubLogin: null } },
});

const madeFrom = describeOperation({
  id: "requests.madeFrom",
  kind: "query",
  label: "Request a task was made from",
  description:
    "The request a task was made from (resolved as it), deleted or not, with where it came from. Reached only through operation calls (the agent decides a run's audience by it).",
  appliesTo: "none",
  input: z.object({
    taskId: id,
    // A request the caller already ties to the task (the agent's own record of
    // the request it was given from), read even if no longer linked to it.
    requestId: id.optional(),
  }),
  subject: (input) => input.taskId,
  effects: [],
  summary: () => "Request a task was made from",
  access: "user",
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
  append,
  fromSender,
  madeFrom,
};
