import { AI_PROVIDERS, type AiProviderId } from "@dlh/core";

export const PROVIDER_NAMES = Object.fromEntries(
  Object.entries(AI_PROVIDERS).map(([id, p]) => [id, p.name]),
) as Record<AiProviderId, string>;

/** The provider offered by "Use <other>": OpenRouter after a CLI, Claude Code after OpenRouter. */
export function otherProvider(provider: AiProviderId): AiProviderId {
  return provider === "openrouter" ? "claude-cli" : "openrouter";
}
