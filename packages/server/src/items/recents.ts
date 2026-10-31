import type { ItemSummary } from "@dlh/core";
import type { Db } from "@dlh/db";
import { items, itemViews } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, max, sql } from "drizzle-orm";
import type { CoreDeps } from "../trpc";
import { summaryColumns, toSummary } from "./read";

const RECENTS_LIMIT = 10;
const VIEW_WINDOW_MS = 5 * 60_000;

/** Records a view unless the item was already viewed in the last 5 minutes. Publishes nothing. */
export async function recordView(deps: CoreDeps, id: string): Promise<void> {
  const now = deps.now();
  const since = new Date(now.getTime() - VIEW_WINDOW_MS);
  await deps.db.transaction(async (tx) => {
    // Lock the item row so concurrent views of one item can't both pass the window check.
    const [item] = await tx
      .select({ id: items.id })
      .from(items)
      .where(and(eq(items.id, id), isNull(items.deletedAt)))
      .for("share");
    if (!item)
      throw new TRPCError({ code: "NOT_FOUND", message: "item not found" });
    await tx.execute(sql`
      insert into item_views (item_id, viewed_at)
      select ${id}::uuid, ${now.toISOString()}::timestamptz
      where not exists (
        select 1 from item_views where item_id = ${id}::uuid and viewed_at > ${since.toISOString()}::timestamptz)`);
  });
}

/** The last 10 distinct live items viewed, most recent first. */
export async function listRecents(db: Db): Promise<ItemSummary[]> {
  const rows = await db
    .select(summaryColumns)
    .from(itemViews)
    .innerJoin(items, eq(items.id, itemViews.itemId))
    .where(isNull(items.deletedAt))
    .groupBy(items.id)
    .orderBy(desc(max(itemViews.viewedAt)))
    .limit(RECENTS_LIMIT);
  return rows.map(toSummary);
}
