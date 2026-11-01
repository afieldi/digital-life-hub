import { AiError, aiErrorMessage, firstLine } from "../errors";
import type { AiProvider } from "./index";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";
const DEFAULT_TIMEOUT_MS = 60_000;

interface Completion {
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

const providerError = (line: string) =>
  new AiError(
    "provider_error",
    aiErrorMessage("provider_error", "openrouter", { firstLine: line }),
  );

export function createOpenRouter(opts: {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): AiProvider {
  const fetchImpl = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return {
    id: "openrouter",
    async complete({ system, prompt, schema, model, signal }) {
      const timeout = AbortSignal.timeout(timeoutMs);
      let res: Response;
      try {
        res = await fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${opts.apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model,
            messages: [
              { role: "system", content: system },
              { role: "user", content: prompt },
            ],
            response_format: {
              type: "json_schema",
              json_schema: { name: "result", strict: true, schema },
            },
            usage: { include: true },
          }),
          signal: AbortSignal.any([signal, timeout]),
        });
      } catch (e) {
        if (timeout.aborted && !signal.aborted) {
          throw new AiError(
            "timeout",
            aiErrorMessage("timeout", "openrouter", {
              seconds: timeoutMs / 1000,
            }),
          );
        }
        throw providerError(
          firstLine(e instanceof Error ? e.message : String(e), opts.apiKey),
        );
      }
      if (res.status === 401 || res.status === 403) {
        throw new AiError(
          "provider_unavailable",
          aiErrorMessage("provider_unavailable", "openrouter", {
            reason: "no_key",
          }),
        );
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw providerError(
          firstLine(
            body.trim() ? body : res.statusText || String(res.status),
            opts.apiKey,
          ),
        );
      }
      const body = (await res.json().catch(() => null)) as Completion | null;
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content === "") {
        throw new AiError(
          "bad_output",
          aiErrorMessage("bad_output", "openrouter"),
        );
      }
      const u = body?.usage;
      return {
        raw: content,
        ...(u &&
        typeof u.prompt_tokens === "number" &&
        typeof u.completion_tokens === "number"
          ? {
              usage: {
                input: u.prompt_tokens,
                output: u.completion_tokens,
                ...(typeof u.cost === "number" ? { costUsd: u.cost } : {}),
              },
            }
          : {}),
      };
    },
  };
}
