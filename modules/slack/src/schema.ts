import { z } from "zod";

/** The Vercel AI Gateway model the interpreter starts with (the spec's Jev check results). */
export const DEFAULT_INTERPRETER = "typesafe-ai/jev";

export const slackSettings = z.object({
  teamId: z.string().nullable(),
  botUserId: z.string().nullable(),
  /** Your Slack user id; until it is set the bot replies "Not set up yet". */
  ownerSlackId: z.string().nullable(),
  ackText: z.string(),
  /** How sure the interpreter must be to act without asking you. */
  threshold: z.number().min(0).max(1),
  /** How long a coworker's later message is appended to their open request. */
  appendMinutes: z.number().int().min(1).max(120),
  /** A Vercel AI Gateway model id. */
  interpreter: z.string().min(1),
  /** Whether a coworker's messages go through the interpreter. */
  coworkerAi: z.boolean(),
});
export type SlackSettings = z.infer<typeof slackSettings>;

export const slackPerson = z.object({
  slackUserId: z.string().min(1),
  name: z.string(),
  githubLogin: z.string().nullable(),
  githubFrom: z.enum(["profile", "manual"]),
});
export type SlackPerson = z.infer<typeof slackPerson>;

/** What `apps/slack` reads at start. */
export const botSettings = z.object({
  ownerSlackId: z.string().nullable(),
  teamId: z.string().nullable(),
  botUserId: z.string().nullable(),
});
export type BotSettings = z.infer<typeof botSettings>;
