import { aiRequests, items, itemViews } from "@dlh/db";
import { and, eq, isNotNull, lt, or, sql } from "drizzle-orm";
import type { CoreDeps } from "../trpc";

const DAY_MS = 24 * 60 * 60_000;
const DELETED_RETENTION_DAYS = 30;
const VIEW_RETENTION_DAYS = 90;
const AI_REQUEST_RETENTION_DAYS = 90;
const AI_UNDO_RETENTION_DAYS = 30;
const AI_PENDING_EXPIRY_MS = 5 * 60_000;
const AI_SUGGESTED_EXPIRY_MS = 30 * 60_000;

export interface PurgeResult {
  items: number;
  views: number;
  aiRequests: number;
  aiUndoCleared: number;
  aiExpired: number;
}

/**
 * Hard-deletes items soft-deleted over 30 days ago (links and views cascade),
 * views over 90 days old and AI requests over 90 days old; clears AI undo
 * records over 30 days old; and marks stale pending/suggested AI requests expired.
 */
export async function purgeExpired(deps: CoreDeps): Promise<PurgeResult> {
  const nowDate = deps.now();
  const now = nowDate.getTime();
  const itemCutoff = new Date(now - DELETED_RETENTION_DAYS * DAY_MS);
  const viewCutoff = new Date(now - VIEW_RETENTION_DAYS * DAY_MS);
  const aiCutoff = new Date(now - AI_REQUEST_RETENTION_DAYS * DAY_MS);
  const undoCutoff = new Date(now - AI_UNDO_RETENTION_DAYS * DAY_MS);
  const pendingCutoff = new Date(now - AI_PENDING_EXPIRY_MS);
  const suggestedCutoff = new Date(now - AI_SUGGESTED_EXPIRY_MS);
  return deps.db.transaction(async (tx) => {
    const views = await tx
      .delete(itemViews)
      .where(lt(itemViews.viewedAt, viewCutoff))
      .returning({ id: itemViews.id });
    const removed = await tx
      .delete(items)
      .where(and(isNotNull(items.deletedAt), lt(items.deletedAt, itemCutoff)))
      .returning({ id: items.id });
    const aiExpired = await tx
      .update(aiRequests)
      .set({ status: "expired", output: null, finishedAt: nowDate })
      .where(
        or(
          and(
            eq(aiRequests.status, "pending"),
            lt(aiRequests.createdAt, pendingCutoff),
          ),
          and(
            eq(aiRequests.status, "suggested"),
            lt(aiRequests.createdAt, suggestedCutoff),
          ),
        ),
      )
      .returning({ id: aiRequests.id });
    const aiUndoCleared = await tx
      .update(aiRequests)
      .set({ undo: null })
      .where(
        and(
          isNotNull(aiRequests.undo),
          lt(
            sql`coalesce(${aiRequests.finishedAt}, ${aiRequests.createdAt})`,
            undoCutoff.toISOString(),
          ),
        ),
      )
      .returning({ id: aiRequests.id });
    const aiDeleted = await tx
      .delete(aiRequests)
      .where(lt(aiRequests.createdAt, aiCutoff))
      .returning({ id: aiRequests.id });
    return {
      items: removed.length,
      views: views.length,
      aiRequests: aiDeleted.length,
      aiUndoCleared: aiUndoCleared.length,
      aiExpired: aiExpired.length,
    };
  });
}
