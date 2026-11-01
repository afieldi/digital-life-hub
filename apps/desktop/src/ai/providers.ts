import type { AiProviderId } from "@dlh/core";

export const PROVIDER_NAMES: Record<AiProviderId, string> = {
  openrouter: "OpenRouter",
  "claude-cli": "Claude Code",
  "codex-cli": "Codex",
};

/** The provider offered by "Use <other>": OpenRouter after a CLI, Claude Code after OpenRouter. */
export function otherProvider(provider: AiProviderId): AiProviderId {
  return provider === "openrouter" ? "claude-cli" : "openrouter";
}
