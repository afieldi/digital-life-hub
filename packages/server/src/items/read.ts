import {
  type Item,
  type ItemSummary,
  type Link,
  type ListCursor,
  linkKind,
} from "@dlh/core";
import { type Db, items, links } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { toLink } from "./links";
import { toItem } from "./writer";

export type LinkWithItem = Link & { item: ItemSummary };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export type SummaryRow = Pick<
  typeof items.$inferSelect,
  "id" | "type" | "title" | "archivedAt"
>;

export const summaryColumns = {
  id: items.id,
  type: items.type,
  title: items.title,
  archivedAt: items.archivedAt,
};

export function toSummary(row: SummaryRow): ItemSummary {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

export async function getItem(db: Db, id: string): Promise<Item> {
  const [row] = await db
    .select()
    .from(items)
    .where(and(eq(items.id, id), isNull(items.deletedAt)));
  if (!row)
    throw new TRPCError({ code: "NOT_FOUND", message: "item not found" });
  return toItem(row);
}

export async function listItems(
  db: Db,
  opts: {
    types?: string[];
    includeArchived?: boolean;
    cursor?: ListCursor;
    limit?: number;
  },
): Promise<{ items: Item[]; nextCursor: ListCursor | null }> {
  const limit = opts.limit ?? DEFAULT_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `limit must be 1 to ${MAX_LIMIT}`,
    });
  }
  const cursor = opts.cursor;
  const rows = await db
    .select()
    .from(items)
    .where(
      and(
        isNull(items.deletedAt),
        opts.includeArchived ? undefined : isNull(items.archivedAt),
        opts.types?.length ? inArray(items.type, opts.types) : undefined,
        cursor
          ? or(
              lt(items.updatedAt, new Date(cursor.updatedAt)),
              and(
                eq(items.updatedAt, new Date(cursor.updatedAt)),
                lt(items.id, cursor.id),
              ),
            )
          : undefined,
      ),
    )
    .orderBy(desc(items.updatedAt), desc(items.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit).map(toItem);
  const last = page.at(-1);
  return {
    items: page,
    nextCursor:
      rows.length > limit && last
        ? { updatedAt: last.updatedAt, id: last.id }
        : null,
  };
}

/** Links of an item in both directions; links whose other end is deleted are hidden. */
export async function linksForItem(
  db: Db,
  id: string,
): Promise<{ outgoing: LinkWithItem[]; backlinks: LinkWithItem[] }> {
  async function side(direction: "outgoing" | "backlinks") {
    const [near, far] =
      direction === "outgoing"
        ? [links.fromId, links.toId]
        : [links.toId, links.fromId];
    const rows = await db
      .select({ link: links, item: summaryColumns })
      .from(links)
      .innerJoin(items, eq(items.id, far))
      .where(and(eq(near, id), isNull(items.deletedAt)))
      .orderBy(links.createdAt, links.id);
    return rows.map((r) => ({ ...toLink(r.link), item: toSummary(r.item) }));
  }
  const [outgoing, backlinks] = await Promise.all([
    side("outgoing"),
    side("backlinks"),
  ]);
  return { outgoing, backlinks };
}

/**
 * Everything reachable from `id` through `contains` links, each item once with the
 * parent it was reached through on the shallowest path. Deleted items are skipped,
 * along with anything reachable only through them.
 */
export async function listContained(
  db: Db,
  id: string,
): Promise<{ item: ItemSummary; via: ItemSummary }[]> {
  const rows = await db.execute<{
    id: string;
    type: string;
    title: string;
    archived_at: Date | null;
    via_id: string;
    via_type: string;
    via_title: string;
    via_archived_at: Date | null;
  }>(sql`
    with recursive tree(id, via_id, depth, linked_at) as (
      select l.to_id, l.from_id, 1, l.created_at
      from links l join items i on i.id = l.to_id
      where l.from_id = ${id} and l.kind = ${linkKind.enum.contains} and i.deleted_at is null
      union
      select l.to_id, l.from_id, t.depth + 1, l.created_at
      from links l
      join tree t on l.from_id = t.id
      join items i on i.id = l.to_id
      where l.kind = ${linkKind.enum.contains} and i.deleted_at is null and l.to_id <> ${id}
    ), best as (
      select distinct on (id) id, via_id, depth, linked_at
      from tree order by id, depth, linked_at
    )
    select c.id, c.type, c.title, c.archived_at,
           v.id as via_id, v.type as via_type, v.title as via_title, v.archived_at as via_archived_at
    from best b
    join items c on c.id = b.id
    join items v on v.id = b.via_id
    order by b.depth, b.linked_at, c.id`);
  return rows.map((r) => ({
    item: toSummary({
      id: r.id,
      type: r.type,
      title: r.title,
      archivedAt: r.archived_at ? new Date(r.archived_at) : null,
    }),
    via: toSummary({
      id: r.via_id,
      type: r.via_type,
      title: r.via_title,
      archivedAt: r.via_archived_at ? new Date(r.via_archived_at) : null,
    }),
  }));
}
