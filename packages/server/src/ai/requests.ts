import type { AiErrorData, AiProviderId } from "@dlh/core";
import { aiRequests } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { CoreDeps, Tx } from "../trpc";
import { AiError, aiErrorMessage } from "./errors";
import type { AiCompleteResult } from "./providers";
import type { AiRunner } from "./runners";

export type RequestRow = typeof aiRequests.$inferSelect;
type RequestPatch = Partial<Omit<RequestRow, "id" | "createdAt">>;
type Updater = { update: Tx["update"] };

/** A single-use step (complete, apply, discard, undo, cancel) was already taken. */
export class RequestUsedError extends TRPCError {
  constructor() {
    super({
      code: "CONFLICT",
      message: "This AI request has already finished or been used.",
    });
  }
}

/** What every suggest output must look like for the gateway to show and apply it. */
export const suggestShape = z.object({
  options: z.array(z.record(z.string(), z.unknown())),
});

export function badRequest(message: string): TRPCError {
  return new TRPCError({ code: "BAD_REQUEST", message });
}

export function conflict(message: string): TRPCError {
  return new TRPCError({ code: "CONFLICT", message });
}

export function runnerFor(deps: CoreDeps, actionId: string): AiRunner {
  const runner = deps.ai.runners.get(actionId);
  if (!runner) throw badRequest(`unknown AI action "${actionId}"`);
  return runner;
}

/** Whether the request is older than `ttlMs` by the deps clock. */
export function expired(
  deps: CoreDeps,
  row: RequestRow,
  ttlMs: number,
): boolean {
  return deps.now().getTime() - row.createdAt.getTime() > ttlMs;
}

const TRPC_CODE: Record<AiErrorData["code"], TRPCError["code"]> = {
  bad_output: "BAD_GATEWAY",
  timeout: "GATEWAY_TIMEOUT",
  provider_unavailable: "SERVICE_UNAVAILABLE",
  provider_error: "BAD_GATEWAY",
  stale: "CONFLICT",
  expired: "PRECONDITION_FAILED",
  not_found: "NOT_FOUND",
};

/** The tRPC error sent for an AI failure; the formatter copies `cause` to `data.ai`. */
export function aiFailure(err: AiError): TRPCError {
  return new TRPCError({
    code: TRPC_CODE[err.code],
    message: err.message,
    cause: err,
  });
}

/** Maps the item writer's version and existence errors to AI error codes. */
export function writeFailure(
  e: unknown,
  provider: AiProviderId,
): AiError | null {
  if (e instanceof AiError) return e;
  if (!(e instanceof TRPCError)) return null;
  if (e.code === "CONFLICT") {
    return new AiError("stale", aiErrorMessage("stale", provider));
  }
  if (e.code === "NOT_FOUND") {
    return new AiError("not_found", aiErrorMessage("not_found", provider));
  }
  return null;
}

export async function loadRow(deps: CoreDeps, id: string): Promise<RequestRow> {
  const [row] = await deps.db
    .select()
    .from(aiRequests)
    .where(eq(aiRequests.id, id));
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "AI request not found" });
  }
  return row;
}

/**
 * Moves the request from status `from`, locking its row for the rest of the
 * transaction. Throws `RequestUsedError` if it is no longer in `from`.
 */
export async function claim(
  db: Updater,
  id: string,
  from: string,
  set: RequestPatch,
): Promise<void> {
  const rows = await db
    .update(aiRequests)
    .set(set)
    .where(and(eq(aiRequests.id, id), eq(aiRequests.status, from)))
    .returning({ id: aiRequests.id });
  if (rows.length === 0) throw new RequestUsedError();
}

/** `finished_at` and `duration_ms` for a request leaving `pending` now. */
export function timing(
  deps: CoreDeps,
  row: RequestRow,
): Pick<RequestRow, "finishedAt" | "durationMs"> {
  const now = deps.now();
  return {
    finishedAt: now,
    durationMs: now.getTime() - row.createdAt.getTime(),
  };
}

export function usagePatch(
  usage: AiCompleteResult["usage"],
): Pick<RequestPatch, "inputTokens" | "outputTokens" | "costUsd"> {
  if (!usage) return {};
  return {
    inputTokens: usage.input,
    outputTokens: usage.output,
    costUsd: usage.costUsd === undefined ? null : String(usage.costUsd),
  };
}

/** Ends the request with `status` (default `failed`) unless another call already moved it. */
export async function markFailed(
  deps: CoreDeps,
  id: string,
  from: string,
  patch: RequestPatch,
  status: "failed" | "expired" = "failed",
): Promise<void> {
  await deps.db
    .update(aiRequests)
    .set({ errorCode: null, errorMessage: null, ...patch, status })
    .where(and(eq(aiRequests.id, id), eq(aiRequests.status, from)));
}

/** Records `err` on the request and throws it as a tRPC error. */
export async function fail(
  deps: CoreDeps,
  id: string,
  from: string,
  err: AiError,
  patch: RequestPatch,
  status: "failed" | "expired" = "failed",
): Promise<never> {
  await markFailed(
    deps,
    id,
    from,
    { ...patch, errorCode: err.code, errorMessage: err.message },
    status,
  );
  throw aiFailure(err);
}
