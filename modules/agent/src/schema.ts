import { askerInput } from "@dlh/core";
import { z } from "zod";

export const runStatus = z.enum([
  "queued",
  "running",
  "waiting",
  "done",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatus>;

export const eventKind = z.enum([
  "text",
  "tool",
  "tool_result",
  "file",
  "permission",
  "status",
]);
export type EventKind = z.infer<typeof eventKind>;

export const connectionType = z.enum([
  "github",
  "aws",
  "slack",
  "linear",
  "gdrive",
  "mcp",
  "env",
]);
export type ConnectionType = z.infer<typeof connectionType>;

/** The open request a run filed and is waiting on. */
export const pending = z.object({
  requestId: z.uuid(),
  seq: z.number().int(),
  kind: z.enum(["approval", "grant", "failure"]),
  connectionId: z.uuid().optional(),
  tool: z.string().optional(),
  inputHash: z.string().optional(),
});
export type Pending = z.infer<typeof pending>;

/**
 * Your answer to `pending`; `delivered` is set by the `claim` that hands it
 * over. It carries what was asked (`tool`, `inputHash`, `connectionId`), so
 * the runner allows only that, never what its volume says was asked.
 */
export const decision = z.object({
  seq: z.number().int(),
  approve: z.boolean(),
  delivered: z.boolean(),
  connectionId: z.uuid().optional(),
  tool: z.string().optional(),
  inputHash: z.string().optional(),
});
export type Decision = z.infer<typeof decision>;

/**
 * Whom a run answers to when it isn't you: the coworker whose Slack request
 * it works on. Its run guard keeps it to what involves them.
 */
export const audience = z.object({ asker: askerInput });
export type Audience = z.infer<typeof audience>;

/** A hub call you approved for a run; `usedAt` once its guard let it through. */
export const hubApproval = z.object({
  tool: z.string(),
  inputHash: z.string(),
  usedAt: z.iso.datetime().nullable(),
});
export type HubApproval = z.infer<typeof hubApproval>;

export const report = z.object({
  summary: z.string(),
  links: z.array(z.object({ label: z.string(), url: z.string() })),
  filesChanged: z.array(z.string()),
});
export type Report = z.infer<typeof report>;

/** Whether `zone` is a time zone `Intl` knows, e.g. "Europe/Warsaw" or "UTC". */
function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

export const settings = z.object({
  defaultConnectionIds: z.array(z.uuid()),
  /** What a run for a coworker's request starts with, in place of the defaults. */
  coworkerConnectionIds: z.array(z.uuid()),
  maxParallel: z.number().int().min(1),
  maxRunningMinutes: z.number().int().min(1),
  // `max_cost_usd` keeps cents, so less than one would store as 0.
  maxCostUsd: z.number().min(0.01),
  instructions: z.string(),
  timeZone: z.string().min(1).refine(isTimeZone, "Unknown time zone"),
});
export type Settings = z.infer<typeof settings>;

/** What `agent.settings` returns: the settings, and when the worker last claimed. */
export const settingsView = settings.extend({
  workerSeenAt: z.iso.datetime().nullable(),
});
export type SettingsView = z.infer<typeof settingsView>;

export const runRow = z.object({
  id: z.uuid(),
  taskId: z.uuid(),
  status: runStatus,
  sessionId: z.string().nullable(),
  workspace: z.string().nullable(),
  connectionIds: z.array(z.uuid()),
  pending: pending.nullable(),
  decision: decision.nullable(),
  failures: z.number().int(),
  heartbeatAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  startedAt: z.iso.datetime().nullable(),
  finishedAt: z.iso.datetime().nullable(),
  failureCode: z.string().nullable(),
  failureMessage: z.string().nullable(),
  report: report.nullable(),
  turns: z.number().int(),
  inputTokens: z.number().int(),
  outputTokens: z.number().int(),
  costUsd: z.number(),
  image: z.string().nullable(),
  audience: audience.nullable(),
});
export type RunRow = z.infer<typeof runRow>;
