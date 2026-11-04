import type { AiEffect } from "@dlh/core";
import { items } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { scopedWriter } from "../ai/scoped";
import { type ItemWriter, writeItems } from "../items/writer";
import { type CoreDeps, protectedProcedure, router } from "../trpc";
import type { ImplementedMutation } from "./implement";

/**
 * An `UndoToken` as clients send it back. `record` may be missing: JSON drops an
 * `undefined` record, so the token a client received types it as optional.
 */
export const undoToken = z.object({
  record: z.unknown().optional(),
  created: z.array(z.uuid()),
  // Absent from tokens stored before callee undos were kept.
  calls: z
    .array(z.object({ operation: z.string(), record: z.unknown().optional() }))
    .default([]),
});

/** Effects whose writes an undo reverses with the opposite method. */
const INVERSE: Partial<Record<AiEffect, AiEffect>> = {
  addLinks: "removeLinks",
  removeLinks: "addLinks",
};

/**
 * Soft-deletes the live items among `ids` at their current version, so items an
 * action created go even if they were edited since.
 */
export async function deleteCreated(
  w: ItemWriter,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const live = await w.tx
    .select({ id: items.id, updatedAt: items.updatedAt })
    .from(items)
    .where(and(inArray(items.id, ids), isNull(items.deletedAt)));
  for (const row of live) {
    await w.setDeleted({
      id: row.id,
      expectedUpdatedAt: row.updatedAt.toISOString(),
      deleted: true,
    });
  }
}

/**
 * Reverts a mutation with its own `undo` in `w`'s transaction. The record, not
 * an input, names what to revert, so the writer has no subject. Created items
 * are not touched: `revertUndoToken` soft-deletes them last.
 */
export async function revertMutation(
  w: ItemWriter,
  deps: CoreDeps,
  op: ImplementedMutation,
  record: unknown,
): Promise<void> {
  const parsed = op.impl.undoRecord.safeParse(record);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `invalid undo record for ${op.desc.id}`,
    });
  }
  const undoEffects = op.desc.effects.flatMap((e) => {
    const inverse = INVERSE[e];
    return inverse ? [e, inverse] : [e];
  });
  const scoped = scopedWriter(w, {
    effects: [...undoEffects, "writeOtherItems"],
    itemId: null,
  });
  await op.impl.undo(scoped, parsed.data, deps);
}

/**
 * Reverts a whole `UndoToken` in `w`'s transaction: the caller's own undo, then
 * each called operation's in reverse call order, then the items it created are
 * soft-deleted. Later changes are reverted before the earlier ones they rest on.
 * A caller with a null record changed nothing itself and is skipped, as a
 * callee with one is never kept.
 */
export async function revertUndoToken(
  w: ItemWriter,
  deps: CoreDeps,
  op: ImplementedMutation,
  token: z.infer<typeof undoToken>,
): Promise<void> {
  if (token.record !== null && token.record !== undefined) {
    await revertMutation(w, deps, op, token.record);
  }
  for (const call of [...token.calls].reverse()) {
    const callee = deps.operations.get(call.operation);
    if (callee?.kind !== "mutation") {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `unknown operation: ${call.operation}`,
      });
    }
    await revertMutation(w, deps, callee, call.record);
  }
  await deleteCreated(w, token.created);
}

export const opsRouter = router({
  /**
   * Reverts a mutation from its `UndoToken` in one transaction with
   * `revertUndoToken`. Refused as a whole with `CONFLICT` "Changed since" when
   * an item it or a called operation reverts changed after the mutation.
   */
  undo: protectedProcedure
    .input(z.object({ id: z.string(), token: undoToken }))
    .output(z.object({ summary: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const op = ctx.deps.operations.get(input.id);
      if (!op) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `unknown operation: ${input.id}`,
        });
      }
      if (op.kind !== "mutation") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `operation ${input.id} can't be undone`,
        });
      }
      try {
        await writeItems(ctx.deps, (w) =>
          revertUndoToken(w, ctx.deps, op, input.token),
        );
      } catch (e) {
        if (e instanceof TRPCError && e.code === "CONFLICT") {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Changed since",
            cause: e,
          });
        }
        throw e;
      }
      return { summary: `Undid ${op.desc.label.toLowerCase()}` };
    }),
});
