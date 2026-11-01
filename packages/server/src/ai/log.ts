import type { AiLogEntry } from "@dlh/core";
import { aiRequests, type Db } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, desc, eq, lt, or, type SQL } from "drizzle-orm";
import { z } from "zod";

export const LOG_PAGE_SIZE = 50;

const cursorShape = z.object({ t: z.iso.datetime(), id: z.uuid() });

function encodeCursor(row: { createdAt: Date; id: string }): string {
  const c = { t: row.createdAt.toISOString(), id: row.id };
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

function decodeCursor(cursor: string): z.infer<typeof cursorShape> {
  try {
    const raw: unknown = JSON.parse(
      Buffer.from(cursor, "base64url").toString("utf8"),
    );
    return cursorShape.parse(raw);
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid cursor" });
  }
}

/** Requests newest first, 50 per page; `nextCursor` is opaque. */
export async function listLog(
  db: Db,
  input: { cursor?: string },
): Promise<{ entries: AiLogEntry[]; nextCursor: string | null }> {
  let where: SQL | undefined;
  if (input.cursor) {
    const c = decodeCursor(input.cursor);
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
      kind: r.kind as AiLogEntry["kind"],
      interpretedBy: r.interpretedBy ?? "manual",
      provider: r.provider as AiLogEntry["provider"],
      model: r.model,
      status: r.status,
      errorCode: r.errorCode as AiLogEntry["errorCode"],
      durationMs: r.durationMs,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
      canUndo: r.status === "applied" && r.undo !== null,
    })),
    nextCursor: rows.length > LOG_PAGE_SIZE && last ? encodeCursor(last) : null,
  };
}
