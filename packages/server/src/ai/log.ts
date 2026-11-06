import {
  type AiLogEntry,
  aiErrorCode,
  aiKind,
  aiProviderId,
  aiRequestStatus,
} from "@dlh/core";
import { aiRequests, type Db } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";
import { opaqueCursor } from "../cursor";

export const LOG_PAGE_SIZE = 50;

/** Where a page ended: the last row's creation time and id. */
const cursor = opaqueCursor(z.object({ t: z.iso.datetime(), id: z.uuid() }));

/** Requests newest first, 50 per page; `nextCursor` is opaque. */
export async function listLog(
  db: Db,
  input: { cursor?: string },
): Promise<{ entries: AiLogEntry[]; nextCursor: string | null }> {
  let where: SQL | undefined;
  if (input.cursor) {
    const c = cursor.decode(input.cursor);
    const at = new Date(c.t);
    where = or(
      lt(aiRequests.createdAt, at),
      and(eq(aiRequests.createdAt, at), lt(aiRequests.id, c.id)),
    );
  }
  const rows = await db
    .select()
    .from(aiRequests)
    .where(where)
    .orderBy(desc(aiRequests.createdAt), desc(aiRequests.id))
    .limit(LOG_PAGE_SIZE + 1);
  const page = rows.slice(0, LOG_PAGE_SIZE);
  const last = page.at(-1);
  return {
    entries: page.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actionId: r.actionId,
      kind: aiKind.parse(r.kind),
      interpretedBy: r.interpretedBy,
      origin: z.enum(["app", "slack"]).parse(r.origin),
      provider: aiProviderId.parse(r.provider),
      model: r.model,
      status: aiRequestStatus.parse(r.status),
      errorCode: aiErrorCode.nullable().parse(r.errorCode),
      durationMs: r.durationMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
      canUndo: r.status === "applied" && r.undo !== null,
    })),
    nextCursor:
      rows.length > LOG_PAGE_SIZE && last
        ? cursor.encode({ t: last.createdAt.toISOString(), id: last.id })
        : null,
  };
}
