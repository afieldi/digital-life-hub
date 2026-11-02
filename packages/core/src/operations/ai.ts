import { z } from "zod";
import { type AiActionDescription, describeAiAction } from "../ai/actions";
import { itemSummary } from "../items";
import type { OperationDescription } from "./describe";

/** The AI action for an operation: queries answer, mutations suggest or do. */
export function toAiAction(d: OperationDescription): AiActionDescription {
  return describeAiAction({
    id: d.id,
    label: d.label,
    description: d.description,
    appliesTo: d.appliesTo,
    kinds: d.kind === "query" ? ["ask"] : ["suggest", "do"],
    effects: d.effects,
    ...(d.words && { words: d.words }),
  });
}

/** What a query shown in ⌘K or to AI returns: rows with at least an `ItemSummary`. */
export const operationList = z.object({
  heading: z.string(),
  items: z.array(itemSummary.loose()),
});
export type OperationList = z.infer<typeof operationList>;
