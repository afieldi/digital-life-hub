import { z } from "zod";

export const aiKind = z.enum(["ask", "suggest", "do"]);
export type AiKind = z.infer<typeof aiKind>;

export const aiProviderId = z.enum(["openrouter", "claude-cli", "codex-cli"]);
export type AiProviderId = z.infer<typeof aiProviderId>;

/**
 * What each provider is: its name in the app, and for a CLI the program the
 * desktop runs. A new provider is one more entry here.
 */
export const AI_PROVIDERS = {
  openrouter: { name: "OpenRouter", program: null },
  "claude-cli": { name: "Claude Code", program: "claude" },
  "codex-cli": { name: "Codex", program: "codex" },
} as const satisfies Record<
  AiProviderId,
  { name: string; program: string | null }
>;

/** The providers the desktop runs as a program (a CLI). */
export type CliProviderId = {
  [K in AiProviderId]: (typeof AI_PROVIDERS)[K]["program"] extends string
    ? K
    : never;
}[AiProviderId];

export const CLI_PROVIDER_IDS = aiProviderId.options.filter(
  (id): id is CliProviderId => AI_PROVIDERS[id].program !== null,
);

export function isCliProvider(id: string): id is CliProviderId {
  return (CLI_PROVIDER_IDS as readonly string[]).includes(id);
}

export const aiEffect = z.enum([
  "updateItem",
  "createItems",
  "addLinks",
  "removeLinks",
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
  "removeLinks",
]);

/** The most autonomous kind an action with these effects may ever run as. */
export function capFor(effects: AiEffect[]): AiKind {
  if (effects.length === 0) return "ask";
  return effects.every((e) => DIRECT_EFFECTS.has(e)) ? "do" : "suggest";
}
