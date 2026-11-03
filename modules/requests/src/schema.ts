import { fields, itemSummary, itemTitle } from "@dlh/core";
import { z } from "zod";

const id = z.uuid();
const expectedUpdatedAt = z.iso.datetime();

/** A new source is a migration on the check constraint. */
export const source = z.enum(["manual", "ai", "slack", "agent"]);
export type Source = z.infer<typeof source>;

export const outcome = z.enum(["task", "handled", "not_for_me"]);
export type Outcome = z.infer<typeof outcome>;

/** A button shown in place of the three outcomes: an operation of a registered module. */
export const requestAction = z.object({
  label: z.string().trim().min(1).max(40),
  operation: z.string(),
  input: z.record(z.string(), z.unknown()),
});
export type RequestAction = z.infer<typeof requestAction>;

export const fileInput = z
  .object({
    title: itemTitle.describe("Title"),
    body: fields.longText().optional().describe("Details"),
    fromName: z.string().trim().min(1).optional().describe("From"),
    source: source.optional(),
    sourceHandle: z.string().optional(),
    sourceUrl: z.url().optional(),
    externalId: z.string().min(1).optional(),
    receivedAt: z.iso.datetime().optional(),
    actions: z.array(requestAction).max(3).optional(),
  })
  .refine((v) => !(v.source === "manual" && v.externalId !== undefined), {
    message: "externalId needs a source other than manual",
    path: ["externalId"],
  });
export type FileInput = z.infer<typeof fileInput>;

export const resolveInput = z
  .object({
    id,
    expectedUpdatedAt,
    outcome,
    taskId: fields.item(["task"]).optional().describe("Task"),
  })
  .refine((v) => (v.outcome === "task") === (v.taskId !== undefined), {
    message: "taskId goes with outcome task, and only with it",
    path: ["taskId"],
  });
export type ResolveInput = z.infer<typeof resolveInput>;

export const requestRow = itemSummary.extend({
  updatedAt: z.string(),
  body: z.string().nullable(),
  fromName: z.string().nullable(),
  source,
  sourceHandle: z.string().nullable(),
  sourceUrl: z.string().nullable(),
  externalId: z.string().nullable(),
  receivedAt: z.string(),
  actions: z.array(requestAction).nullable(),
  resolvedAt: z.string().nullable(),
  outcome: outcome.nullable(),
});
export type RequestRow = z.infer<typeof requestRow>;
