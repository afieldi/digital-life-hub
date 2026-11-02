import type { AiEffect } from "@dlh/core";
import { links } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { ItemWriter } from "../items/writer";

/**
 * What an AI runner or a module operation may write with. Effects limit writes
 * to Core items and links; `tx` is exposed only so a module can write its own
 * tables (modules are lint-barred from importing @dlh/db tables, so effects
 * cannot govern those).
 */
export type ScopedWriter = Pick<ItemWriter, "tx"> &
  Partial<Omit<ItemWriter, "tx">>;

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
  scope: { effects: AiEffect[]; itemId: string | null; created?: string[] },
): ScopedWriter {
  const has = (e: AiEffect) => scope.effects.includes(e);
  const anywhere = has("writeOtherItems");
  const inScope = (id: string) => anywhere || id === scope.itemId;
  const out: ScopedWriter = { tx: w.tx };

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
