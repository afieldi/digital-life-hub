import type { AiProviderId } from "@dlh/core";
import { aiRequests } from "@dlh/db";
import { z } from "zod";
import type { CoreDeps } from "../trpc";
import { AiError, aiErrorMessage, firstLine } from "./errors";
import { serverProvider } from "./gateway";
import type { AiDecisionProvider } from "./providers";
import { claim, markFailed, usagePatch } from "./requests";

const DEFAULT_TIMEOUT_MS = 30_000;

type Usage = { input: number; output: number; costUsd?: number } | undefined;

/** The provider's own error, else a timeout when our deadline fired, else `provider_error`. */
function asAiError(
  e: unknown,
  provider: AiProviderId,
  signal: AbortSignal,
  timeoutMs: number,
): AiError {
  // Our own deadline wins: a provider aborted by it reports `provider_error`.
  if (signal.aborted) {
    return new AiError(
      "timeout",
      aiErrorMessage("timeout", provider, { seconds: timeoutMs / 1000 }),
    );
  }
  if (e instanceof AiError) return e;
  return new AiError(
    "provider_error",
    aiErrorMessage("provider_error", provider, {
      firstLine: firstLine(e instanceof Error ? e.message : String(e)),
    }),
  );
}

/**
 * Runs `call` as a logged server-side request (origin `slack`): one
 * `ai_requests` row, `done` or `failed`, with usage and duration. Errors are
 * thrown as `AiError`.
 */
async function logged<T>(
  deps: CoreDeps,
  meta: {
    purpose: string;
    provider: AiProviderId;
    model: string;
    timeoutMs: number;
  },
  call: (signal: AbortSignal) => Promise<{ value: T; usage?: Usage }>,
): Promise<{ value: T; requestId: string }> {
  const [row] = await deps.db
    .insert(aiRequests)
    .values({
      createdAt: deps.now(),
      actionId: meta.purpose,
      kind: "ask",
      provider: meta.provider,
      model: meta.model,
      status: "pending",
      origin: "slack",
    })
    .returning();
  if (!row) throw new Error("ai_requests insert returned no row");
  const signal = AbortSignal.timeout(meta.timeoutMs);
  const timing = () => {
    const now = deps.now();
    return {
      finishedAt: now,
      durationMs: now.getTime() - row.createdAt.getTime(),
    };
  };
  const failWith = async (err: AiError): Promise<never> => {
    await markFailed(deps, row.id, "pending", {
      ...timing(),
      errorCode: err.code,
      errorMessage: err.message,
    });
    throw err;
  };
  let out: { value: T; usage?: Usage };
  try {
    out = await call(signal);
  } catch (e) {
    return failWith(asAiError(e, meta.provider, signal, meta.timeoutMs));
  }
  await claim(deps.db, row.id, "pending", {
    ...timing(),
    ...usagePatch(out.usage),
    status: "answered",
  });
  return { value: out.value, requestId: row.id };
}

function unavailable(provider: AiProviderId): AiError {
  return new AiError(
    "provider_unavailable",
    aiErrorMessage("provider_unavailable", provider, { reason: "no_key" }),
  );
}

/**
 * A structured completion the server asks for itself (the Slack bot's
 * interpreter), not for a person in the app. The answer is parsed with
 * `schema`; one `ai_requests` row records it.
 */
export async function completeOnServer<T>(
  deps: CoreDeps,
  req: {
    purpose: string;
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    model?: string;
    timeoutMs?: number;
  },
): Promise<{ value: T; requestId: string }> {
  const id = serverProvider(deps);
  const provider = id ? deps.ai.providers[id] : undefined;
  const model = req.model ?? (id ? deps.ai.defaultModels[id] : undefined);
  if (!id || !provider || !model) throw unavailable(id ?? "openrouter");
  const timeoutMs = req.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  return logged(
    deps,
    { purpose: req.purpose, provider: id, model, timeoutMs },
    async (signal) => {
      const result = await provider.complete({
        system: req.system,
        prompt: req.prompt,
        schema: z.toJSONSchema(req.schema) as object,
        model,
        signal,
      });
      try {
        return {
          value: req.schema.parse(JSON.parse(result.raw)),
          usage: result.usage,
        };
      } catch {
        throw new AiError("bad_output", aiErrorMessage("bad_output", id));
      }
    },
  );
}

/**
 * A decision-model call (`POST /v1/decisions`), reachable only through the
 * Vercel Gateway. Logged like `completeOnServer`.
 */
export async function decideOnServer(
  deps: CoreDeps,
  req: {
    purpose: string;
    question: {
      name: string;
      instructions: string;
      choices: { value: string; description: string }[];
    };
    input: string;
    model: string;
    timeoutMs?: number;
  },
): Promise<{
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
  requestId: string;
}> {
  const vercel = deps.ai.providers.vercel as AiDecisionProvider | undefined;
  if (!vercel) throw unavailable("vercel");
  const { value, requestId } = await logged(
    deps,
    {
      purpose: req.purpose,
      provider: "vercel",
      model: req.model,
      timeoutMs: req.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    },
    async (signal) => {
      const { usage, ...answer } = await vercel.decide({
        model: req.model,
        input: req.input,
        question: req.question,
        signal,
      });
      return { value: answer, usage };
    },
  );
  return { ...value, requestId };
}
