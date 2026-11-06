import { AiError, aiErrorMessage } from "../errors";
import type { AiDecisionProvider } from "./index";
import { createOpenAiCompatible, postJson } from "./openaiCompatible";

const BASE = "https://ai-gateway.vercel.sh/v1";

interface DecisionAnswer {
  choice?: unknown;
  confidence?: unknown;
  probabilities?: { value?: unknown; probability?: unknown }[];
}

interface DecisionResponse {
  answers?: DecisionAnswer[];
  usage?: { input_tokens?: unknown; output_tokens?: unknown };
  provider_metadata?: { gateway?: { cost?: unknown } };
}

/**
 * Vercel AI Gateway: chat completions like OpenRouter, plus `decide` for
 * decision models (Jev, Luna), which only `/v1/decisions` reaches.
 */
export function createVercelGateway(opts: {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): AiDecisionProvider {
  const post = { ...opts, id: "vercel" } as const;
  const chat = createOpenAiCompatible({
    ...post,
    endpoint: `${BASE}/chat/completions`,
  });
  const badOutput = () =>
    new AiError("bad_output", aiErrorMessage("bad_output", "vercel"));
  return {
    ...chat,
    async decide({ model, input, question, signal }) {
      const res = await postJson(
        post,
        `${BASE}/decisions`,
        { model, input, questions: [{ type: "choice", ...question }] },
        signal,
      );
      const body = (await res
        .json()
        .catch(() => null)) as DecisionResponse | null;
      const answer = body?.answers?.[0];
      const { choice, confidence } = answer ?? {};
      if (
        typeof choice !== "string" ||
        !question.choices.some((c) => c.value === choice)
      ) {
        throw badOutput();
      }
      if (typeof confidence !== "number") throw badOutput();
      const probabilities: Record<string, number> = {};
      for (const p of answer?.probabilities ?? []) {
        if (typeof p.value === "string" && typeof p.probability === "number") {
          probabilities[p.value] = p.probability;
        }
      }
      const u = body?.usage;
      const cost = Number(body?.provider_metadata?.gateway?.cost);
      return {
        choice,
        confidence,
        probabilities,
        ...(u &&
        typeof u.input_tokens === "number" &&
        typeof u.output_tokens === "number"
          ? {
              usage: {
                input: u.input_tokens,
                output: u.output_tokens,
                ...(body?.provider_metadata?.gateway?.cost !== undefined &&
                Number.isFinite(cost)
                  ? { costUsd: cost }
                  : {}),
              },
            }
          : {}),
      };
    },
  };
}
