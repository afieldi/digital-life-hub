import { AiError, aiErrorMessage, firstLine } from "../errors";

const AUTH_HINT = /authenticate|oauth|login|log in/i;

function badOutput(provider: "claude-cli" | "codex-cli"): AiError {
  return new AiError("bad_output", aiErrorMessage("bad_output", provider));
}

/**
 * Reduces CLI stdout to the model's JSON text. Claude Code prints a JSON envelope
 * (`-p --output-format json`); for Codex the caller passes the last-message file.
 */
export function unwrapCliOutput(
  provider: "claude-cli" | "codex-cli",
  stdout: string,
): string {
  if (provider === "codex-cli") {
    const text = stdout.trim();
    if (!text) throw badOutput(provider);
    return text;
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    throw badOutput(provider);
  }
  if (
    typeof envelope !== "object" ||
    envelope === null ||
    Array.isArray(envelope)
  ) {
    throw badOutput(provider);
  }
  const { is_error, result, structured_output } = envelope as {
    is_error?: unknown;
    result?: unknown;
    structured_output?: unknown;
  };
  if (is_error === true) {
    const text = typeof result === "string" ? result : "";
    if (AUTH_HINT.test(text)) {
      throw new AiError(
        "provider_unavailable",
        aiErrorMessage("provider_unavailable", provider, {
          reason: "signed_out",
        }),
      );
    }
    throw new AiError(
      "provider_error",
      aiErrorMessage("provider_error", provider, {
        firstLine: firstLine(text),
      }),
    );
  }
  if (structured_output !== undefined && structured_output !== null) {
    return JSON.stringify(structured_output);
  }
  if (typeof result === "string" && result !== "") return result;
  throw badOutput(provider);
}
