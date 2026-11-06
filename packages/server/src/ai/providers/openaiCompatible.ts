import type { AiProviderId } from "@dlh/core";
import { AiError, aiErrorMessage, firstLine } from "../errors";
import type { AiProvider } from "./index";

export const DEFAULT_TIMEOUT_MS = 60_000;

export interface PostOptions {
  id: AiProviderId;
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * POSTs `body` as JSON with the bearer key and returns the 2xx response.
 * Anything else becomes an AiError: 401/403 is `provider_unavailable`, a
 * timeout is `timeout`, the rest `provider_error` (the key is redacted).
 */
export async function postJson(
  opts: PostOptions,
  url: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const { id, apiKey } = opts;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const providerError = (line: string) =>
    new AiError(
      "provider_error",
      aiErrorMessage("provider_error", id, { firstLine: line }),
    );
  const timeout = AbortSignal.timeout(timeoutMs);
  let res: Response;
  try {
    res = await (opts.fetch ?? fetch)(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, timeout]),
    });
  } catch (e) {
    if (timeout.aborted && !signal.aborted) {
      throw new AiError(
        "timeout",
        aiErrorMessage("timeout", id, { seconds: timeoutMs / 1000 }),
      );
    }
    throw providerError(
      firstLine(e instanceof Error ? e.message : String(e), apiKey),
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new AiError(
      "provider_unavailable",
      aiErrorMessage("provider_unavailable", id, { reason: "no_key" }),
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw providerError(
      firstLine(
        text.trim() ? text : res.statusText || String(res.status),
        apiKey,
      ),
    );
  }
  return res;
}

interface Completion {
  choices?: { message?: { content?: unknown } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
}

/** A server provider that speaks OpenAI-style chat completions with `usage.cost`. */
export function createOpenAiCompatible(
  opts: PostOptions & { endpoint: string },
): AiProvider {
  const { id } = opts;
  return {
    id,
    async complete({ system, prompt, schema, model, signal }) {
      const res = await postJson(
        opts,
        opts.endpoint,
        {
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
        },
        signal,
      );
      const body = (await res.json().catch(() => null)) as Completion | null;
      const content = body?.choices?.[0]?.message?.content;
      if (typeof content !== "string" || content === "") {
        throw new AiError("bad_output", aiErrorMessage("bad_output", id));
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
