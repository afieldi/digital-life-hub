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
 * are not touched: callers soft-delete them first with `deleteCreated`.
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

export const opsRouter = router({
  /**
   * Reverts a mutation from its `UndoToken`, in one transaction: created items
   * first, then the operation's `undo`. Refused with `CONFLICT` "Changed since"
   * when an item it reverts changed after the mutation.
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
        await writeItems(ctx.deps, async (w) => {
          await deleteCreated(w, input.token.created);
          await revertMutation(w, ctx.deps, op, input.token.record);
        });
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
