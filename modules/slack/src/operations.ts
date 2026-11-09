import { describeOperation } from "@dlh/core";
import { agentOps } from "@dlh/module-agent/operations";
import { requestOps } from "@dlh/module-requests/operations";
import { z } from "zod";
import {
  escalatable,
  handleActionWire,
  handleMessageInput,
  slackSettings,
} from "./schema";

/** Settings → Slack's calls: yours only, and out of ⌘K and AI. */
const mine = { access: "user", palette: false, ai: false } as const;
/** What `apps/slack` calls: only its slack token, and out of ⌘K and AI. */
const bot = { access: "slack", palette: false, ai: false } as const;

const settings = describeOperation({
  id: "slack.settings",
  kind: "query",
  label: "Slack settings",
  description: "How the Slack bot answers: owner, acknowledgement, threshold.",
  appliesTo: ["none"],
  input: z.object({}),
  subject: () => null,
  effects: [],
  summary: () => "Slack settings",
  ...mine,
});

const setSettings = describeOperation({
  id: "slack.setSettings",
  kind: "mutation",
  label: "Change Slack settings",
  description: "Changes how the Slack bot answers.",
  appliesTo: ["none"],
  input: slackSettings.partial(),
  subject: () => null,
  effects: [],
  summary: () => "Change Slack settings",
  ...mine,
});

const people = describeOperation({
  id: "slack.people",
  kind: "query",
  label: "Slack people",
  description: "The people the bot has met, with their GitHub logins.",
  appliesTo: ["none"],
  input: z.object({}),
  subject: () => null,
  effects: [],
  summary: () => "Slack people",
  ...mine,
});

const setGithubLogin = describeOperation({
  id: "slack.setGithubLogin",
  kind: "mutation",
  label: "Set a GitHub login",
  description: "Sets the GitHub login of a Slack person; the bot keeps it.",
  appliesTo: ["none"],
  input: z.object({
    slackUserId: z.string().min(1),
    githubLogin: z.string().trim().min(1).nullable(),
  }),
  subject: () => null,
  effects: [],
  summary: () => "Set a GitHub login",
  ...mine,
});

const botSettingsQuery = describeOperation({
  id: "slack.botSettings",
  kind: "query",
  label: "Bot settings",
  description: "The owner, team and bot ids the Slack service needs.",
  appliesTo: ["none"],
  input: z.object({}),
  subject: () => null,
  effects: [],
  summary: () => "Bot settings",
  ...bot,
});

const upsertPerson = describeOperation({
  id: "slack.upsertPerson",
  kind: "mutation",
  label: "Record a Slack person",
  description:
    "Records a person from their Slack profile; a GitHub login you set is kept.",
  appliesTo: ["none"],
  input: z.object({
    slackUserId: z.string().min(1),
    name: z.string(),
    githubLogin: z.string().trim().min(1).nullable(),
  }),
  subject: () => null,
  effects: [],
  summary: () => "Record a Slack person",
  ...bot,
});

const handleMessage = describeOperation({
  id: "slack.handleMessage",
  kind: "mutation",
  label: "Handle a Slack message",
  description:
    "The entry point for every Slack message: files, appends or answers, and says what to post.",
  appliesTo: ["none"],
  input: handleMessageInput,
  subject: () => null,
  effects: [],
  calls: [
    requestOps.file,
    requestOps.append,
    requestOps.fromSender,
    requestOps.resolve,
  ],
  summary: () => "Handle a Slack message",
  ...bot,
});

const handleAction = describeOperation({
  id: "slack.handleAction",
  kind: "mutation",
  label: "Handle a Slack button",
  description:
    "What a button under a bot reply asks for: apply, discard or undo one of its requests, undo an action it made, or cancel a run.",
  appliesTo: ["none"],
  input: handleActionWire,
  subject: () => null,
  effects: [],
  calls: [],
  summary: () => "Handle a Slack button",
  ...bot,
});

const pendingSends = describeOperation({
  id: "slack.pendingSends",
  kind: "mutation",
  label: "Pending Slack sends",
  description:
    "Notes the bot is alive, fails approved messages older than a day, and returns the next approved ones to post.",
  appliesTo: ["none"],
  input: z.object({}),
  subject: () => null,
  effects: [],
  summary: () => "Pending Slack sends",
  ...bot,
});

const markSent = describeOperation({
  id: "slack.markSent",
  kind: "mutation",
  label: "Mark a Slack message sent",
  description:
    "Records that an approved outbox message was posted; a repeat changes nothing.",
  appliesTo: ["none"],
  input: z.object({ id: z.uuid(), ts: z.string().min(1) }),
  subject: () => null,
  effects: [],
  summary: () => "Mark a Slack message sent",
  ...bot,
});

const markFailed = describeOperation({
  id: "slack.markFailed",
  kind: "mutation",
  label: "Mark a Slack message failed",
  description:
    "Records that posting an approved outbox message failed; a repeat changes nothing.",
  appliesTo: ["none"],
  input: z.object({ id: z.uuid(), error: z.string().min(1) }),
  subject: () => null,
  effects: [],
  summary: () => "Mark a Slack message failed",
  ...bot,
});

/** Which escalation: the message it was filed for, as the request's `sourceHandle` and `externalId`. */
const message = {
  slackUserId: z.string().min(1),
  externalId: z.string().min(1),
};

const runEscalated = describeOperation({
  id: "slack.runEscalated",
  kind: "mutation",
  label: "Run for an escalation",
  description:
    "Runs what the bot could have done for an escalated message, as it would have, resolves the request as handled and queues the reply for the thread.",
  appliesTo: ["none"],
  input: z.object({ ...message, command: escalatable }),
  subject: () => null,
  effects: [],
  calls: [
    requestOps.get,
    requestOps.file,
    requestOps.append,
    requestOps.fromSender,
    requestOps.resolve,
  ],
  summary: () => "Run for an escalation",
  ...mine,
});

const dismissEscalation = describeOperation({
  id: "slack.dismissEscalation",
  kind: "mutation",
  label: "Neither",
  description:
    "Resolves an escalation as not for me, kept for tuning the threshold; nothing is posted.",
  appliesTo: ["none"],
  input: z.object(message),
  subject: () => null,
  effects: [],
  calls: [requestOps.get, requestOps.fromSender, requestOps.resolve],
  summary: () => "Dismiss an escalation",
  ...mine,
});

const syncRuns = describeOperation({
  id: "slack.syncRuns",
  kind: "mutation",
  label: "Report agent runs",
  description:
    "Queues a report in your DM or thread for each agent run that ended since the last sync and came from a message you sent. The first call only starts the clock.",
  appliesTo: ["none"],
  input: z.object({}),
  subject: () => null,
  effects: [],
  calls: [agentOps.recentRuns, requestOps.get],
  summary: () => "Report agent runs",
  ...bot,
});

const postToSource = describeOperation({
  id: "slack.postToSource",
  kind: "mutation",
  label: "Post to the Slack thread",
  description:
    "For an agent run whose task came from a Slack message: posts text as the bot in that message's thread, at most five times a run.",
  appliesTo: ["none"],
  input: z.object({
    runId: z.uuid(),
    text: z.string().trim().min(1).max(2000),
  }),
  subject: () => null,
  effects: [],
  calls: [agentOps.runSource, requestOps.get],
  // A hub tool for agent runs only: not in ⌘K, the in-app AI or Slack's.
  access: "everyone",
  palette: false,
  ai: false,
  hub: true,
  summary: () => "Post to the Slack thread",
});

export const slackOps = {
  settings,
  setSettings,
  people,
  setGithubLogin,
  botSettings: botSettingsQuery,
  upsertPerson,
  handleMessage,
  handleAction,
  pendingSends,
  markSent,
  markFailed,
  runEscalated,
  dismissEscalation,
  syncRuns,
  postToSource,
};
