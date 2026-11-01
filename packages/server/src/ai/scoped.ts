import type { AiEffect } from "@dlh/core";
import { TRPCError } from "@trpc/server";
import type { ItemWriter } from "../items/writer";

export type ScopedWriter = Pick<ItemWriter, "tx"> &
  Partial<Omit<ItemWriter, "tx">>;

function forbidden(): never {
  throw new TRPCError({
    code: "FORBIDDEN",
    message: "AI action wrote outside its effects",
  });
}

/**
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

  if (has("updateItem") || anywhere) {
    out.updateItem = async (i) => {
      if (!(has("updateItem") ? inScope(i.id) : false)) forbidden();
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
