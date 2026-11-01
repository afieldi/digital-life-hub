import type { AiEffect } from "@dlh/core";
import { TRPCError } from "@trpc/server";
import type { ItemWriter } from "../items/writer";

/**
 * What an AI runner may write with. Effects limit writes to Core items and links;
 * `tx` is exposed only so a module's runner can write the module's own tables
 * (modules are lint-barred from importing @dlh/db tables, so effects cannot govern those).
 */
export type ScopedWriter = Pick<ItemWriter, "tx"> &
  Partial<Omit<ItemWriter, "tx">>;

function forbidden(): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "AI action wrote outside its effects",
  });
}

/**
 * Effects govern Core item/link writes only; `tx` is for the module's own tables.
 * Wraps `w` so an AI action can only do what its declared effects allow.
 * Methods the effects do not allow are absent; allowed ones are restricted to
 * `scope.itemId` unless `writeOtherItems` is declared. `removeLink` is never exposed.
 */
export function scopedWriter(
  w: ItemWriter,
  scope: { effects: AiEffect[]; itemId: string | null },
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
    out.createItem = (i) => w.createItem(i);
  }
  if (has("addLinks")) {
    out.addLink = async (i) => {
      if (!inScope(i.fromId)) forbidden();
      return w.addLink(i);
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
