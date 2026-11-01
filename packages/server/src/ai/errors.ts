import type { AiErrorData, AiProviderId } from "@dlh/core";

export const PROVIDER_NAMES: Record<AiProviderId, string> = {
  openrouter: "OpenRouter",
  "claude-cli": "Claude Code",
  "codex-cli": "Codex",
};

const CLI_COMMANDS: Partial<Record<AiProviderId, string>> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
};

export class AiError extends Error {
  readonly code: AiErrorData["code"];
  constructor(code: AiErrorData["code"], message: string) {
    super(message);
    this.name = "AiError";
    this.code = code;
  }
}

/** User-facing copy for each AI error code. */
export function aiErrorMessage(
  code: AiErrorData["code"],
  provider: AiProviderId,
  extra: {
    seconds?: number;
    firstLine?: string;
    reason?: "not_installed" | "signed_out" | "no_key";
  } = {},
): string {
  const name = PROVIDER_NAMES[provider];
  switch (code) {
    case "bad_output":
      return `${name}'s answer wasn't in the expected format, so nothing was changed.`;
    case "timeout":
      return `${name} didn't answer within ${extra.seconds ?? 0} seconds.`;
    case "provider_unavailable":
      if (extra.reason === "not_installed") {
        return `${name} isn't installed on this computer.`;
      }
      if (extra.reason === "signed_out") {
        return `${name} isn't signed in. Run \`${CLI_COMMANDS[provider] ?? provider}\` once in a terminal to sign in.`;
      }
      return "OpenRouter isn't set up on the server.";
    case "provider_error":
      return `${name} returned an error: ${extra.firstLine ?? "unknown error"}.`;
    case "stale":
      return `This item changed while ${name} was working, so nothing was changed.`;
    case "expired":
      return "This suggestion expired.";
    case "not_found":
      return "This item was deleted.";
  }
}

/** First non-empty line of `text`, trimmed of a trailing period. */
export function firstLine(text: string): string {
  const line = text.split("\n").find((l) => l.trim() !== "") ?? "";
  return line.trim().replace(/\.$/, "") || "unknown error";
}
