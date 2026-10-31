import { type Link, linkKind } from "@dlh/core";
import { items, links } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Tx } from "../trpc";

/** Serialises every `contains` insert so two adds can't each pass the loop check. */
const CONTAINS_LOCK_KEY = 7243001;

type LinkRow = typeof links.$inferSelect;

export function toLink(row: LinkRow): Link {
  return {
    id: row.id,
    fromId: row.fromId,
    toId: row.toId,
    kind: linkKind.parse(row.kind),
    context: row.context,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function insertLink(
  tx: Tx,
  i: { fromId: string; toId: string; kind: string; context?: string | null },
  touch: (itemId: string) => void,
): Promise<Link> {
  const kind = linkKind.safeParse(i.kind);
  if (!kind.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `link kind not allowed: ${i.kind}`,
    });
  }
  if (i.fromId === i.toId) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "an item can't link to itself",
    });
  }
  const live = await tx
    .select({ id: items.id })
    .from(items)
    .where(and(inArray(items.id, [i.fromId, i.toId]), isNull(items.deletedAt)));
  if (live.length !== 2) {
    throw new TRPCError({ code: "NOT_FOUND", message: "item not found" });
  }

  if (kind.data === "contains") {
    await tx.execute(sql`select pg_advisory_xact_lock(${CONTAINS_LOCK_KEY})`);
    // Deliberately ignores deleted_at: restoring an item must never create a loop.
    const rows = await tx.execute<{ loop: boolean }>(sql`
      with recursive reach(id) as (
        select to_id from links where from_id = ${i.toId} and kind = 'contains'
        union
        select l.to_id from links l join reach r on l.from_id = r.id where l.kind = 'contains'
      ) select exists (select 1 from reach where id = ${i.fromId}) as loop`);
    if (rows[0]?.loop) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "would make an item contain itself",
      });
    }
  }

  const [inserted] = await tx
    .insert(links)
    .values({
      fromId: i.fromId,
      toId: i.toId,
      kind: kind.data,
      context: i.context ?? null,
    })
    .onConflictDoNothing({ target: [links.fromId, links.toId, links.kind] })
    .returning();
  const row =
    inserted ??
    (
      await tx
        .select()
        .from(links)
        .where(
          and(
            eq(links.fromId, i.fromId),
            eq(links.toId, i.toId),
            eq(links.kind, kind.data),
          ),
        )
    )[0];
  touch(i.fromId);
  touch(i.toId);
  return toLink(row);
}

export async function deleteLink(
  tx: Tx,
  id: string,
  touch: (itemId: string) => void,
): Promise<void> {
  const [row] = await tx.delete(links).where(eq(links.id, id)).returning();
  if (!row) {
    throw new TRPCError({ code: "NOT_FOUND", message: "link not found" });
  }
  touch(row.fromId);
  touch(row.toId);
}
