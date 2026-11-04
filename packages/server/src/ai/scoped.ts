import type { AiEffect, OperationDescription } from "@dlh/core";
import { links } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { z } from "zod";
import type { ItemWriter } from "../items/writer";

/**
 * What an AI runner or a module operation may write with. Effects limit writes
 * to Core items and links; `tx` is exposed only so a module can write its own
 * tables (modules are lint-barred from importing @dlh/db tables, so effects
 * cannot govern those).
 */
export type ScopedWriter = Pick<ItemWriter, "tx"> &
  Partial<Omit<ItemWriter, "tx">> & {
    /**
     * Runs an operation the running mutation declared in `calls`, in this
     * transaction, and returns its result. Present only when it declared any.
     */
    call?: <D extends OperationDescription>(
      op: D,
      input: z.input<D["input"]>,
    ) => Promise<unknown>;
    /**
     * True when this writer is a called operation's, inside another
     * operation's run; absent for a top-level run.
     */
    viaCall?: boolean;
  };

function forbidden(): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "Write outside the declared effects",
  });
}

/**
 * Effects govern Core item/link writes only; `tx` is for the module's own tables.
 * Wraps `w` so an AI action or operation can only do what its declared effects
 * allow. Methods the effects do not allow are absent; allowed ones are restricted
 * to `scope.itemId` (for links, their `fromId`) unless `writeOtherItems` is
 * declared. Ids of items created through it are pushed to `scope.created`.
 */
export function scopedWriter(
  w: ItemWriter,
  scope: {
    effects: AiEffect[];
    itemId: string | null;
    created?: string[];
    viaCall?: boolean;
  },
): ScopedWriter {
  const has = (e: AiEffect) => scope.effects.includes(e);
  const anywhere = has("writeOtherItems");
  const inScope = (id: string) => anywhere || id === scope.itemId;
  const out: ScopedWriter = scope.viaCall
    ? { tx: w.tx, viaCall: true }
    : { tx: w.tx };

  if (has("updateItem")) {
    out.updateItem = async (i) => {
      if (!inScope(i.id)) forbidden();
      return w.updateItem(i);
    };
  }
  if (has("createItems")) {
    out.createItem = async (i) => {
      const item = await w.createItem(i);
      scope.created?.push(item.id);
      return item;
    };
  }
  if (has("addLinks")) {
    out.addLink = async (i) => {
      if (!inScope(i.fromId)) forbidden();
      return w.addLink(i);
    };
  }
  if (has("removeLinks")) {
    out.removeLink = async (id) => {
      const [link] = await w.tx
        .select({ fromId: links.fromId })
        .from(links)
        .where(eq(links.id, id));
      if (link && !inScope(link.fromId)) forbidden();
      return w.removeLink(id);
    };
  }
  if (has("touchItems")) {
    // A state change on one item is shown on others (a run on its task), so any item.
    out.touchItem = (id) => w.touchItem(id);
  }
  if (has("deleteItems")) {
    out.setDeleted = async (i) => {
      if (!inScope(i.id)) forbidden();
      return w.setDeleted(i);
    };
  }
  if (has("setArchived")) {
    out.setArchived = async (i) => {
      if (!inScope(i.id)) forbidden();
      return w.setArchived(i);
    };
  }
  return out;
}
