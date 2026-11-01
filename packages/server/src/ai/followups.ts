import type { AiProviderId, AiResult } from "@dlh/core";
import { TRPCError } from "@trpc/server";
import { writeItems } from "../items/writer";
import type { CoreDeps } from "../trpc";
import type { AiContext } from "./context";
import { AiError, aiErrorMessage } from "./errors";
import {
  aiFailure,
  badRequest,
  claim,
  conflict,
  expired,
  fail,
  loadRow,
  markFailed,
  type RequestRow,
  RequestUsedError,
  runnerFor,
  suggestShape,
  timing,
  writeFailure,
} from "./requests";
import type { AiRunner } from "./runners";
import { scopedWriter } from "./scoped";

/** An unpicked suggestion may be applied for this long after prepare. */
const SUGGESTION_TTL_MS = 30 * 60_000;

/** The runner's context, pinned to the item version noted at prepare. */
async function contextAt(
  deps: CoreDeps,
  runner: AiRunner,
  row: RequestRow,
): Promise<AiContext> {
  if (row.itemVersion && !row.itemId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "item not found" });
  }
  const ctx = await runner.context(deps, row.itemId);
  return { ...ctx, version: row.itemVersion?.toISOString() ?? ctx.version };
}

/**
 * Applies `out` through the scoped writer and marks the request applied in the
 * same transaction. Writer conflicts end the request `stale`, a missing item
 * `not_found`; any other error rolls back and ends it `failed`.
 */
export async function runApply(
  deps: CoreDeps,
  runner: AiRunner,
  row: RequestRow,
  from: "pending" | "suggested",
  out: unknown,
  patch: Partial<RequestRow>,
): Promise<string> {
  const provider = row.provider as AiProviderId;
  const apply = runner.apply;
  if (!apply) throw badRequest(`AI action "${runner.action.id}" can't apply`);
  const endPatch = { ...patch, output: null };
  try {
    const ctx = await contextAt(deps, runner, row);
    await writeItems(deps, async (w) => {
      await claim(w.tx, row.id, from, { ...endPatch, status: "applied" });
      const scoped = scopedWriter(w, {
        effects: runner.action.effects,
        itemId: row.itemId,
      });
      const record = await apply.call(runner, scoped, out, ctx);
      if (record !== undefined && record !== null) {
        await claim(w.tx, row.id, "applied", { undo: record });
      }
    });
    return runner.summary?.(out, ctx) ?? runner.action.label;
  } catch (e) {
    if (e instanceof RequestUsedError) throw e;
    const err = writeFailure(e, provider);
    if (err) return fail(deps, row.id, from, err, endPatch);
    await markFailed(deps, row.id, from, {
      ...endPatch,
      errorMessage: "The action failed on the server.",
    });
    throw e;
  }
}

/** Applies one of a suggestion's options, once, within 30 minutes. */
export async function apply(
  deps: CoreDeps,
  input: { requestId: string; option: number },
): Promise<AiResult & { status: "applied" }> {
  const row = await loadRow(deps, input.requestId);
  if (row.status !== "suggested") throw new RequestUsedError();
  const provider = row.provider as AiProviderId;
  if (expired(deps, row, SUGGESTION_TTL_MS)) {
    return fail(
      deps,
      row.id,
      "suggested",
      new AiError("expired", aiErrorMessage("expired", provider)),
      { output: null },
      "expired",
    );
  }
  const runner = runnerFor(deps, row.actionId);
  const options = suggestShape.safeParse(row.output).data?.options ?? [];
  const chosen = options[input.option];
  if (!Number.isInteger(input.option) || !chosen) {
    throw badRequest(`no option ${input.option}`);
  }
  const summary = await runApply(deps, runner, row, "suggested", chosen, {});
  return { requestId: row.id, status: "applied", summary };
}

/** "None of these": drops a suggestion's options. */
export async function discard(
  deps: CoreDeps,
  input: { requestId: string },
): Promise<{ ok: true }> {
  const row = await loadRow(deps, input.requestId);
  await claim(deps.db, row.id, "suggested", {
    status: "discarded",
    output: null,
  });
  return { ok: true };
}

/** Abandons a pending CLI request. */
export async function cancel(
  deps: CoreDeps,
  input: { requestId: string },
): Promise<{ ok: true }> {
  const row = await loadRow(deps, input.requestId);
  await claim(deps.db, row.id, "pending", {
    status: "cancelled",
    ...timing(deps, row),
  });
  return { ok: true };
}

/**
 * Reverts an applied request with its stored undo record, once. Refused as
 * `stale` (and left applied) if the item changed since.
 */
export async function undo(
  deps: CoreDeps,
  input: { requestId: string },
): Promise<{ summary: string }> {
  const row = await loadRow(deps, input.requestId);
  if (row.status !== "applied" || row.undo === null) {
    throw new RequestUsedError();
  }
  const runner = runnerFor(deps, row.actionId);
  const revert = runner.undo;
  if (!revert) throw conflict("This change can't be undone.");
  try {
    await writeItems(deps, async (w) => {
      await claim(w.tx, row.id, "applied", { status: "undone", undo: null });
      await revert.call(
        runner,
        scopedWriter(w, { effects: runner.action.effects, itemId: row.itemId }),
        row.undo,
      );
    });
  } catch (e) {
    const err =
      e instanceof RequestUsedError
        ? null
        : writeFailure(e, row.provider as AiProviderId);
    throw err ? aiFailure(err) : e;
  }
  return { summary: `Undid ${runner.action.label.toLowerCase()}` };
}
