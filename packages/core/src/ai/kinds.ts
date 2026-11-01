import { z } from "zod";

export const aiKind = z.enum(["ask", "suggest", "do"]);
export type AiKind = z.infer<typeof aiKind>;

export const aiProviderId = z.enum(["openrouter", "claude-cli", "codex-cli"]);
export type AiProviderId = z.infer<typeof aiProviderId>;

export const aiEffect = z.enum([
  "updateItem",
  "createItems",
  "addLinks",
  "deleteItems",
  "setArchived",
  "writeOtherItems",
]);
export type AiEffect = z.infer<typeof aiEffect>;

/** Kinds ordered from least to most autonomous. */
export const AI_KIND_ORDER: readonly AiKind[] = ["ask", "suggest", "do"];

/** Effects that are safe enough to run without the person confirming first. */
const DIRECT_EFFECTS: ReadonlySet<AiEffect> = new Set([
  "updateItem",
  "createItems",
  "addLinks",
]);

/** The most autonomous kind an action with these effects may ever run as. */
export function capFor(effects: AiEffect[]): AiKind {
  if (effects.length === 0) return "ask";
  return effects.every((e) => DIRECT_EFFECTS.has(e)) ? "do" : "suggest";
}
