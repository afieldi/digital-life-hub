import {
  describeOperation,
  fields,
  itemOnScreen,
  NotReady,
  type PaletteContext,
  type PaletteRead,
} from "@dlh/core";
import { requestOps } from "@dlh/module-requests/operations";
import { taskOps } from "@dlh/module-tasks/operations";
import { z } from "zod";
import {
  connectionType,
  eventKind,
  report,
  runStatus,
  settings,
} from "./schema";

const id = z.uuid();
const runId = z.uuid();
const taskId = z.uuid();
const requestId = z.uuid();
const expectedUpdatedAt = z.iso.datetime();
/** Connections for one run, over the defaults from Settings. */
const connections = z.array(z.uuid());
const MAX_EVENTS_PER_CALL = 200;
/** What the dev fake answers a run action with, when the run can't be guessed. */
const FAKE_RUN_ID = "0197a000-0000-7000-8000-000000000000";

/** The run states that still hold the task's one slot, and those a Retry can restart. */
const LIVE: readonly string[] = ["queued", "running", "waiting"];
const RETRYABLE: readonly string[] = ["failed", "cancelled"];

/** What ⌘K needs of `agent.runs` for the task on screen. */
const runsView = z.object({
  runs: z.array(z.object({ id: z.uuid(), status: runStatus })),
});

/** Reads the task on screen's runs, newest first, and picks one by status for a run action. */
function runOf(states: readonly string[]) {
  return async (ctx: PaletteContext, read: PaletteRead) => {
    const { id: task } = itemOnScreen(ctx);
    const { runs } = runsView.parse(await read("agent.runs", { taskId: task }));
    const run = runs.find((r) => states.includes(r.status));
    if (!run) throw new NotReady("No run to act on");
    return { runId: run.id };
  };
}

const runParams = z.object({ runId: runId.describe("Run") });

const assign = describeOperation({
  id: "agent.assign",
  kind: "mutation",
  label: "Make AI task",
  description:
    "Hands the task on screen to the AI agent, which works on it in the background and files a request when it needs the person. Use when the person wants the agent to do a task.",
  appliesTo: ["task"],
  words: [
    "to the agent",
    "ai task",
    "let the agent",
    "have the agent",
    "delegate",
    "assign",
    "hand",
    "agent take",
    "ai agent",
  ],
  // `id`, not `taskId`: AI fills the item on screen's keys from its `id`.
  devFake: {},
  input: z.object({
    id: taskId,
    expectedUpdatedAt,
    connections: connections.optional(),
  }),
  subject: (input) => input.id,
  // Sets the AI cap (suggest, you confirm). Touching is left to setAssignee's version bump: a touchItem after it would break its undo.
  effects: ["touchItems"],
  calls: [taskOps.setAssignee],
  access: "user",
  summary: () => "Make AI task",
  palette: (ctx) => {
    const item = itemOnScreen(ctx);
    return { id: item.id, expectedUpdatedAt: item.expectedUpdatedAt };
  },
});

const assignRequest = describeOperation({
  id: "agent.assignRequest",
  kind: "mutation",
  label: "Give to agent",
  description:
    "Makes a task from the request on screen, hands it to the AI agent and resolves the request as a task. Use when the person wants the agent to deal with a request.",
  appliesTo: ["request"],
  words: [
    "to the agent",
    "let the agent",
    "have the agent",
    "delegate",
    "assign",
    "hand",
    "pass this on",
    "ai agent",
    "agent deal with",
  ],
  input: z.object({
    id: requestId,
    expectedUpdatedAt,
    title: z.string().min(1).optional(),
    notes: fields.longText().optional(),
    connections: connections.optional(),
  }),
  subject: (input) => input.id,
  // Sets the AI cap (suggest, you confirm). Touching is left to setAssignee's version bump: a touchItem after it would break its undo.
  effects: ["touchItems"],
  calls: [taskOps.create, taskOps.setAssignee, requestOps.resolve],
  access: "user",
  summary: () => "Give to agent",
  palette: (ctx) => {
    const item = itemOnScreen(ctx);
    return { id: item.id, expectedUpdatedAt: item.expectedUpdatedAt };
  },
});

const unassign = describeOperation({
  id: "agent.unassign",
  kind: "mutation",
  label: "Back to me",
  description:
    "Takes the task on screen back from the AI agent and stops its run. Use when the person wants to do the task themselves.",
  appliesTo: ["task"],
  words: [
    "back to me",
    "take back",
    "take this back",
    "take this task back",
    "unassign",
    "myself",
    "my task again",
    "don't let the agent",
  ],
  input: z.object({ id: taskId, expectedUpdatedAt }),
  subject: (input) => input.id,
  effects: ["touchItems"],
  calls: [taskOps.setAssignee],
  access: "user",
  summary: () => "Back to me",
  palette: (ctx) => {
    const item = itemOnScreen(ctx);
    return { id: item.id, expectedUpdatedAt: item.expectedUpdatedAt };
  },
});

const message = describeOperation({
  id: "agent.message",
  kind: "mutation",
  label: "Tell the agent…",
  description:
    "Sends a message to a run that is working or waiting; it reads it at its next step.",
  appliesTo: ["task"],
  input: z.object({ runId, body: fields.longText() }),
  subject: () => null,
  effects: [],
  access: "user",
  ai: false,
  summary: () => "Message the agent",
  palette: {
    params: z.object({
      runId: runId.describe("Run"),
      body: fields.longText().describe("Message"),
    }),
    load: runOf(LIVE.filter((s) => s !== "queued")),
    toInput: (_ctx, params) => params,
  },
});

const cancel = describeOperation({
  id: "agent.cancel",
  kind: "mutation",
  label: "Cancel run",
  description:
    "Stops the task's agent run and keeps its workspace. Use when the person wants the agent to stop.",
  appliesTo: ["task"],
  words: [
    "cancel",
    "stop the agent",
    "halt the agent",
    "abort",
    "kill",
    "stop working",
    "stop the run",
    "stop run",
  ],
  devFake: { runId: FAKE_RUN_ID },
  input: z.object({ runId }),
  subject: () => null,
  effects: ["touchItems"],
  access: "user",
  summary: () => "Cancel run",
  palette: {
    params: runParams,
    load: runOf(LIVE),
    toInput: (_ctx, params) => params,
  },
});

const retry = describeOperation({
  id: "agent.retry",
  kind: "mutation",
  label: "Retry run",
  description:
    "Queues the task's failed or cancelled agent run again, with the same session. Use when the person wants the agent to try again.",
  appliesTo: ["task"],
  words: [
    "retry",
    "try again",
    "run again",
    "run the agent again",
    "restart",
    "resume",
    "run it again",
    "agent try again",
  ],
  devFake: { runId: FAKE_RUN_ID },
  input: z.object({ runId }),
  subject: () => null,
  effects: ["touchItems"],
  calls: [requestOps.resolve],
  access: "user",
  summary: () => "Retry run",
  palette: {
    params: runParams,
    load: runOf(RETRYABLE),
    toInput: (_ctx, params) => params,
  },
});

const decide = describeOperation({
  id: "agent.decide",
  kind: "mutation",
  label: "Answer the agent",
  description:
    "Approves or declines what a waiting run asked for, and queues it to go on. Behind the Approve and Decline actions.",
  appliesTo: ["request"],
  input: z.object({ runId, seq: z.number().int(), approve: z.boolean() }),
  subject: () => null,
  effects: ["touchItems"],
  calls: [requestOps.resolve],
  access: "user",
  palette: false,
  ai: false,
  summary: (input) => (input.approve ? "Approve" : "Decline"),
});

const run = describeOperation({
  id: "agent.run",
  kind: "query",
  label: "Run",
  description: "One agent run, for the detail panel.",
  appliesTo: ["task"],
  input: z.object({ runId }),
  subject: () => null,
  effects: [],
  access: "user",
  palette: false,
  ai: false,
  summary: () => "Run",
});

const runs = describeOperation({
  id: "agent.runs",
  kind: "query",
  label: "Agent runs",
  description:
    "Lists the AI agent's runs, newest first: those of the task on screen, or all with a given status. Use when the person asks what the agent is doing or has done.",
  appliesTo: ["task"],
  words: [
    "what is the agent doing",
    "what did the agent do",
    "what has the agent done",
    "agent working",
    "show the agent",
    "list the agent",
    "what the agent ran",
    "how did the agent",
    "agent run are running",
  ],
  devFake: { status: "running" },
  input: z.object({
    taskId: taskId.optional(),
    status: runStatus.optional(),
  }),
  subject: (input) => input.taskId ?? null,
  effects: [],
  access: "user",
  palette: false,
  summary: () => "Agent runs",
});

const events = describeOperation({
  id: "agent.events",
  kind: "query",
  label: "Run events",
  description:
    "A run's events after a sequence number, at most 500, for its log.",
  appliesTo: ["task"],
  input: z.object({ runId, after: z.number().int().optional() }),
  subject: () => null,
  effects: [],
  access: "user",
  palette: false,
  ai: false,
  summary: () => "Run events",
});

const connectionsQuery = describeOperation({
  id: "agent.connections",
  kind: "query",
  label: "Connections",
  description:
    "The agent's connections: name, type, scope summary and whether each is a default or disabled. Never a secret.",
  appliesTo: ["none"],
  input: z.object({}),
  subject: () => null,
  effects: [],
  access: "user",
  palette: false,
  ai: false,
  summary: () => "Connections",
});

const setDefaultConnections = describeOperation({
  id: "agent.setDefaultConnections",
  kind: "mutation",
  label: "Set default connections",
  description: "Sets the connections every new agent run gets.",
  appliesTo: ["none"],
  input: z.object({ ids: z.array(id) }),
  subject: () => null,
  effects: [],
  access: "user",
  palette: false,
  ai: false,
  summary: () => "Set default connections",
});

const disableConnection = describeOperation({
  id: "agent.disableConnection",
  kind: "mutation",
  label: "Disable connection",
  description: "Stops the agent using a connection from its next start.",
  appliesTo: ["none"],
  input: z.object({ id }),
  subject: () => null,
  effects: [],
  access: "user",
  palette: false,
  ai: false,
  summary: () => "Disable connection",
});

const settingsQuery = describeOperation({
  id: "agent.settings",
  kind: "query",
  label: "Agent settings",
  description: "The agent's limits, instructions and default connections.",
  appliesTo: ["none"],
  input: z.object({}),
  subject: () => null,
  effects: [],
  access: "user",
  palette: false,
  ai: false,
  summary: () => "Agent settings",
});

const setSettings = describeOperation({
  id: "agent.setSettings",
  kind: "mutation",
  label: "Change agent settings",
  description: "Changes the agent's limits, instructions or time zone.",
  appliesTo: ["none"],
  input: settings.partial(),
  subject: () => null,
  effects: [],
  access: "user",
  palette: false,
  ai: false,
  summary: () => "Change agent settings",
});

/** What every worker operation has: only the host's worker token, and out of ⌘K and AI. */
const worker = { access: "worker", palette: false, ai: false } as const;

const claim = describeOperation({
  id: "agent.claim",
  kind: "mutation",
  label: "Claim a run",
  description:
    "Hands the host the next queued run, or a run that has an answer to deliver, with its task, request and settings.",
  appliesTo: ["none"],
  input: z.object({}),
  subject: () => null,
  effects: ["touchItems"],
  calls: [taskOps.get, requestOps.get],
  summary: () => "Claim a run",
  ...worker,
});

const heartbeat = describeOperation({
  id: "agent.heartbeat",
  kind: "mutation",
  label: "Heartbeat",
  description:
    "Shows a run is alive and adds its usage so far; answers whether it should stop.",
  appliesTo: ["none"],
  input: z.object({
    runId,
    turns: z.number().int().min(0),
    inputTokens: z.number().int().min(0),
    outputTokens: z.number().int().min(0),
    costUsd: z.number().min(0),
  }),
  subject: () => null,
  effects: [],
  summary: () => "Heartbeat",
  ...worker,
});

const appendEvents = describeOperation({
  id: "agent.appendEvents",
  kind: "mutation",
  label: "Append events",
  description: "Adds a batch of a run's events to its log.",
  appliesTo: ["none"],
  input: z.object({
    runId,
    events: z
      .array(
        z.object({
          seq: z.number().int(),
          at: z.iso.datetime(),
          kind: eventKind,
          data: z.record(z.string(), z.unknown()),
        }),
      )
      .max(MAX_EVENTS_PER_CALL),
  }),
  subject: () => null,
  effects: [],
  summary: () => "Append events",
  ...worker,
});

const takeMessages = describeOperation({
  id: "agent.takeMessages",
  kind: "mutation",
  label: "Take messages",
  description: "Hands a run the messages sent to it and marks them delivered.",
  appliesTo: ["none"],
  input: z.object({ runId }),
  subject: () => null,
  effects: [],
  summary: () => "Take messages",
  ...worker,
});

const suspend = describeOperation({
  id: "agent.suspend",
  kind: "mutation",
  label: "Suspend run",
  description:
    "Parks a run to wait for the person and files the request that asks.",
  appliesTo: ["none"],
  input: z.object({
    runId,
    sessionId: z.string().min(1),
    seq: z.number().int(),
    kind: z.enum(["approval", "grant"]),
    title: z.string().min(1),
    body: z.string(),
    tool: z.string().optional(),
    inputHash: z.string().optional(),
    connectionId: z.uuid().optional(),
  }),
  subject: () => null,
  effects: ["touchItems"],
  calls: [requestOps.file],
  summary: () => "Suspend run",
  ...worker,
});

const finish = describeOperation({
  id: "agent.finish",
  kind: "mutation",
  label: "Finish run",
  description: "Ends a run as done with its report and completes its task.",
  appliesTo: ["none"],
  input: z.object({ runId, report }),
  subject: () => null,
  effects: ["touchItems"],
  calls: [taskOps.complete],
  summary: () => "Finish run",
  ...worker,
});

const fail = describeOperation({
  id: "agent.fail",
  kind: "mutation",
  label: "Fail run",
  description: "Ends a run as failed and files a request about it.",
  appliesTo: ["none"],
  input: z.object({ runId, code: z.string().min(1), message: z.string() }),
  subject: () => null,
  effects: ["touchItems"],
  calls: [requestOps.file],
  summary: () => "Fail run",
  ...worker,
});

const registerConnection = describeOperation({
  id: "agent.registerConnection",
  kind: "mutation",
  label: "Register connection",
  description:
    "Records a connection's name, type and scope summary. The secret stays on the host.",
  appliesTo: ["none"],
  input: z.object({
    name: z.string().min(1),
    type: connectionType,
    scopeSummary: z.string(),
  }),
  subject: () => null,
  effects: [],
  summary: () => "Register connection",
  ...worker,
});

export const agentOps = {
  assign,
  assignRequest,
  unassign,
  message,
  cancel,
  retry,
  decide,
  run,
  runs,
  events,
  connections: connectionsQuery,
  setDefaultConnections,
  disableConnection,
  settings: settingsQuery,
  setSettings,
  claim,
  heartbeat,
  appendEvents,
  takeMessages,
  suspend,
  finish,
  fail,
  registerConnection,
};
