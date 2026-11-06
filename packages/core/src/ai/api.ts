import { z } from "zod";
import { itemSummary, itemTitle } from "../items";
import { timeZoneValue } from "../time";
import { interpreterId } from "./interpreters";
import { aiKind, aiProviderId } from "./kinds";

export { aiKind, aiProviderId };

export const aiPrepareInput = z.object({
  text: z.string().max(2000),
  itemId: z.uuid().optional(),
  actionId: z.string(),
  kind: aiKind,
  interpretedBy: z.string().optional(),
  provider: aiProviderId.optional(),
  /** The device's IANA zone: today's date in the prompt, and a query's `timeZone`. */
  timeZone: timeZoneValue.optional(),
});
export type AiPrepareInput = z.infer<typeof aiPrepareInput>;

export const aiCompleteInput = z.object({
  requestId: z.uuid(),
  raw: z.string().max(1_048_576),
});
export type AiCompleteInput = z.infer<typeof aiCompleteInput>;

/**
 * Applies a suggestion, once: one `option`, or for a `multiSelect` action the
 * ticked `options` (indexes, at least one).
 */
export const aiApplyInput = z
  .object({
    requestId: z.uuid(),
    option: z.number().int().min(0).optional(),
    options: z.array(z.number().int().min(0)).min(1).optional(),
  })
  .refine((i) => (i.option === undefined) !== (i.options === undefined), {
    message: "Give either option or options",
  });
export type AiApplyInput = z.infer<typeof aiApplyInput>;

/** A row an AI answer lists, with an optional line about it (Plan today's reason). */
export const aiListedItem = itemSummary.extend({
  note: z.string().optional(),
  /** Finished since the model saw it: shown struck through. */
  done: z.boolean().optional(),
});
export type AiListedItem = z.infer<typeof aiListedItem>;

export const aiResult = z.discriminatedUnion("status", [
  z.object({
    requestId: z.string(),
    status: z.literal("answered"),
    answer: z.string(),
    used: z.array(z.string()),
  }),
  z.object({
    requestId: z.string(),
    status: z.literal("suggested"),
    options: z.array(
      z.object({ label: z.string(), reason: z.string().optional() }),
    ),
    /** A checklist: apply any of the options together with `options`. */
    multiSelect: z.boolean().optional(),
  }),
  z.object({
    requestId: z.string(),
    status: z.literal("listed"),
    heading: z.string(),
    items: z.array(aiListedItem),
  }),
  z.object({
    requestId: z.string(),
    status: z.literal("applied"),
    summary: z.string(),
  }),
  z.object({
    requestId: z.string(),
    status: z.literal("run"),
    run: z.object({
      provider: aiProviderId,
      system: z.string(),
      prompt: z.string(),
      schema: z.unknown(),
    }),
  }),
]);
export type AiResult = z.infer<typeof aiResult>;

/**
 * Where an AI request is: `pending` until the model answers (or a CLI run
 * completes); then answered, listed, suggested or applied; and from those,
 * undone, discarded, cancelled, failed or expired.
 */
export const aiRequestStatus = z.enum([
  "pending",
  "answered",
  "listed",
  "suggested",
  "applied",
  "undone",
  "discarded",
  "cancelled",
  "failed",
  "expired",
]);
export type AiRequestStatus = z.infer<typeof aiRequestStatus>;

export const aiSettings = z.object({
  defaultProvider: aiProviderId,
  openrouterModel: z.string().nullable(),
  interpreter: interpreterId,
});
export type AiSettings = z.infer<typeof aiSettings>;

export const aiErrorCode = z.enum([
  "bad_output",
  "timeout",
  "provider_unavailable",
  "provider_error",
  "stale",
  "expired",
  "not_found",
  "internal",
]);

export const aiErrorData = z.object({
  code: aiErrorCode,
  message: z.string(),
});
export type AiErrorData = z.infer<typeof aiErrorData>;

/**
 * Abandons a pending CLI request. With `error` (a failure on the app's side,
 * such as a CLI timeout) the request ends `failed` instead of `cancelled`.
 */
export const aiCancelInput = z.object({
  requestId: z.uuid(),
  error: z
    .object({ code: aiErrorCode, message: z.string().max(4000) })
    .optional(),
});
export type AiCancelInput = z.infer<typeof aiCancelInput>;

export const aiLogEntry = z.object({
  id: z.string(),
  createdAt: z.string(),
  actionId: z.string(),
  kind: aiKind,
  interpretedBy: z.string().nullable(),
  /** "slack" for the bot's server-side requests, "app" otherwise. */
  origin: z.enum(["app", "slack"]),
  provider: aiProviderId,
  model: z.string().nullable(),
  status: aiRequestStatus,
  errorCode: aiErrorCode.nullable(),
  durationMs: z.number().int().nullable(),
  inputTokens: z.number().int().nullable(),
  outputTokens: z.number().int().nullable(),
  costUsd: z.number().nullable(),
  canUndo: z.boolean(),
});
export type AiLogEntry = z.infer<typeof aiLogEntry>;

/** Title the AI may propose when renaming; same rules as any item title. */
export const aiRetitleOutput = z.object({ title: itemTitle });
