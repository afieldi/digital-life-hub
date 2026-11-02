import type { AiCancelInput, AiProviderId, AiResult } from "@dlh/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { type ItemWriter, writeItems } from "../items/writer";
import { runMutationIn } from "../operations/implement";
import { deleteCreated, revertMutation } from "../operations/undo";
import type { CoreDeps } from "../trpc";
import type { AiContext } from "./context";
import { AiError, aiErrorMessage, firstLine } from "./errors";
import { operationUndo, subjectAllowed } from "./operation-runner";
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
import type { AiRunner, RunnerTools } from "./runners";
import { scopedWriter } from "./scoped";

function forbidden(message: string): never {
  throw new TRPCError({ code: "FORBIDDEN", message });
}

/**
 * Core's tools for `runner` on the request's item `itemId`; items its
 * mutations create are pushed to `created`. A mutation may have only effects
 * the runner declares, and act on the item on screen, none, or an item it
 * names, unless the runner declares `writeOtherItems`.
 */
export function toolsFor(
  w: ItemWriter,
  deps: CoreDeps,
  runner: AiRunner,
  itemId: string | null,
  created?: string[],
): RunnerTools {
  const effects = runner.action.effects;
  return {
    async mutate(op, input) {
      if (!op.desc.effects.every((e) => effects.includes(e))) {
        forbidden(
          `"${op.desc.id}" has effects AI action "${runner.action.id}" doesn't declare`,
        );
      }
      if (
        !effects.includes("writeOtherItems") &&
        !subjectAllowed(op.desc, input, itemId)
      ) {
        forbidden(
          `"${op.desc.id}" would change another item than the one open`,
        );
      }
      const done = await runMutationIn(w, deps, op, input);
      created?.push(...done.undo.created);
      return done;
    },
    revert: (op, record) => revertMutation(w, deps, op, record),
  };
}

/**
 * A hand-written runner's undo record as Core stores it: `created` is what Core
 * saw it create, so it is safe to delete on undo.
 */
const createdUndo = z.object({
  kind: z.literal("created"),
  created: z.array(z.uuid()),
  record: z.unknown(),
});

/**
 * The undo record to store, or null for none. A hand-written runner's record
 * (`created` is set) is always wrapped, so a record shaped like the wrapper is
 * never read as one.
 */
function storedUndo(created: string[] | undefined, record: unknown): unknown {
  const none = record === undefined || record === null;
  if (!created) return none ? null : record;
  if (none && created.length === 0) return null;
  return { kind: "created", created, record: record ?? null };
}

/**
 * What to delete and what to hand the runner's `undo` for a stored record. An
 * operation runner's tagged record lists what it created; a hand-written
 * runner's is wrapped in `createdUndo`. Anything else is passed on as is and
 * deletes nothing.
 */
function unwrapUndo(
  runner: AiRunner,
  stored: unknown,
): { created: string[]; record: unknown } {
  if (runner.operation) {
    const parsed = operationUndo.safeParse(stored);
    const ok = parsed.success && parsed.data.operation === runner.action.id;
    return { created: ok ? parsed.data.token.created : [], record: stored };
  }
  const wrapped = createdUndo.safeParse(stored);
  return wrapped.success
    ? { created: wrapped.data.created, record: wrapped.data.record }
    : { created: [], record: stored };
}

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
      // An operation runner's own record already lists what it created.
      const created: string[] | undefined = runner.operation ? undefined : [];
      const scoped = scopedWriter(w, {
        effects: runner.action.effects,
        itemId: row.itemId,
        created,
      });
      const record = await apply.call(
        runner,
        scoped,
        out,
        ctx,
        toolsFor(w, deps, runner, row.itemId, created),
      );
      const stored = storedUndo(created, record);
      if (stored !== null) {
        await claim(w.tx, row.id, "applied", { undo: stored });
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

/**
 * The chosen option, or for `options` (a `multiSelect` action only) the
 * chosen options as one array, deduped in the order given.
 */
function chosenOut(
  runner: AiRunner,
  options: Record<string, unknown>[],
  input: { option?: number; options?: number[] },
): unknown {
  const at = (i: number) => {
    const chosen = Number.isInteger(i) ? options[i] : undefined;
    if (!chosen) throw badRequest(`no option ${i}`);
    return chosen;
  };
  if (input.options === undefined) {
    if (input.option === undefined) throw badRequest("no option chosen");
    return at(input.option);
  }
  if (!runner.action.multiSelect) {
    throw badRequest(
      `AI action "${runner.action.id}" applies one option at a time`,
    );
  }
  if (input.options.length === 0) throw badRequest("no option chosen");
  return [...new Set(input.options)].map(at);
}

/**
 * Applies a suggestion, once, within 30 minutes: one option, or several
 * together for a `multiSelect` action.
 */
export async function apply(
  deps: CoreDeps,
  input: { requestId: string; option?: number; options?: number[] },
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
  const chosen = chosenOut(runner, options, input);
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

/**
 * Abandons a pending CLI request: `cancelled`, or `failed` with the error's
 * code and first line when the app reports why the CLI run failed.
 */
export async function cancel(
  deps: CoreDeps,
  input: AiCancelInput,
): Promise<{ ok: true }> {
  const row = await loadRow(deps, input.requestId);
  const end = input.error
    ? {
        status: "failed",
        errorCode: input.error.code,
        errorMessage: firstLine(input.error.message),
      }
    : { status: "cancelled" };
  await claim(deps.db, row.id, "pending", { ...end, ...timing(deps, row) });
  return { ok: true };
}

/**
 * Reverts an applied request with its stored undo record, once: items it
 * created are soft-deleted, then the runner's `undo` runs. Refused as
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
      // Core removes what the action created; the runner's writer can't delete.
      const { created, record } = unwrapUndo(runner, row.undo);
      await deleteCreated(w, created);
      await revert.call(
        runner,
        scopedWriter(w, { effects: runner.action.effects, itemId: row.itemId }),
        record,
        toolsFor(w, deps, runner, row.itemId),
      );
    });
  } catch (e) {
    const err =
      e instanceof RequestUsedError
        ? null
        : writeFailure(e, row.provider as AiProviderId);
    // A stale undo can never succeed later, so stop offering it.
    if (err?.code === "stale") {
      await claim(deps.db, row.id, "applied", { undo: null }).catch(
        (clearErr: unknown) => {
          if (!(clearErr instanceof RequestUsedError)) throw clearErr;
        },
      );
    }
    throw err ? aiFailure(err) : e;
  }
  return { summary: `Undid ${runner.action.label.toLowerCase()}` };
}
