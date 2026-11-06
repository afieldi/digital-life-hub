import { describeOperation } from "@dlh/core";
import { requestOps } from "@dlh/module-requests/operations";
import { z } from "zod";
import { handleMessageInput, slackSettings } from "./schema";

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

export const slackOps = {
  settings,
  setSettings,
  people,
  setGithubLogin,
  botSettings: botSettingsQuery,
  upsertPerson,
  handleMessage,
};
