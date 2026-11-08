import { implementOperation } from "@dlh/server";
import { and, asc, eq, lt, sql } from "drizzle-orm";
import { z } from "zod";
import { slackOutbox, slackSettings } from "../db/schema";
import { slackOps } from "../operations";

/** How many rows one `pendingSends` hands the service. */
const BATCH = 20;
/** Past this an approved row is stale: a late message is worse than none. */
const STALE_HOURS = 24;

/** Assumes a single sender loop: rows are read without locks, so two loops could post one twice. */
export const pendingSends = implementOperation(slackOps.pendingSends, {
  async run(w) {
    await w.tx
      .update(slackSettings)
      .set({ seenAt: sql`now()` })
      .where(eq(slackSettings.id, 1));
    await w.tx
      .update(slackOutbox)
      .set({ status: "failed", error: "Too old to send" })
      .where(
        and(
          eq(slackOutbox.status, "approved"),
          lt(
            slackOutbox.approvedAt,
            sql`now() - make_interval(hours => ${STALE_HOURS})`,
          ),
        ),
      );
    const rows = await w.tx
      .select({
        id: slackOutbox.id,
        channelId: slackOutbox.channelId,
        threadTs: slackOutbox.threadTs,
        text: slackOutbox.text,
      })
      .from(slackOutbox)
      .where(eq(slackOutbox.status, "approved"))
      .orderBy(asc(slackOutbox.approvedAt), asc(slackOutbox.id))
      .limit(BATCH);
    return { result: rows, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

export const markSent = implementOperation(slackOps.markSent, {
  async run(w, input) {
    // Only an approved row moves, so a repeat or a race changes nothing.
    await w.tx
      .update(slackOutbox)
      .set({ status: "sent", sentTs: input.ts, sentAt: sql`now()` })
      .where(
        and(eq(slackOutbox.id, input.id), eq(slackOutbox.status, "approved")),
      );
    return { result: null, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});

export const markFailed = implementOperation(slackOps.markFailed, {
  async run(w, input) {
    await w.tx
      .update(slackOutbox)
      .set({ status: "failed", error: input.error })
      .where(
        and(eq(slackOutbox.id, input.id), eq(slackOutbox.status, "approved")),
      );
    return { result: null, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
});
