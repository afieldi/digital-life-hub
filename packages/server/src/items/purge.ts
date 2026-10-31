import { items, itemViews } from "@dlh/db";
import { and, isNotNull, lt } from "drizzle-orm";
import type { CoreDeps } from "../trpc";

const DAY_MS = 24 * 60 * 60_000;
const DELETED_RETENTION_DAYS = 30;
const VIEW_RETENTION_DAYS = 90;

/** Hard-deletes items soft-deleted over 30 days ago (links and views cascade) and views over 90 days old. */
export async function purgeExpired(
  deps: CoreDeps,
): Promise<{ items: number; views: number }> {
  const now = deps.now().getTime();
  const itemCutoff = new Date(now - DELETED_RETENTION_DAYS * DAY_MS);
  const viewCutoff = new Date(now - VIEW_RETENTION_DAYS * DAY_MS);
  return deps.db.transaction(async (tx) => {
    const views = await tx
      .delete(itemViews)
      .where(lt(itemViews.viewedAt, viewCutoff))
      .returning({ id: itemViews.id });
    const removed = await tx
      .delete(items)
      .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, itemCutoff)))
      .returning({ id: items.id });
    return { items: removed.length, views: views.length };
  });
}
