import { implementOperation } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { requestOps } from "../operations";
import type { RequestRow } from "../schema";
import { requestTask, requestTasks } from "./links";
import { toRequestRow } from "./writes";

const DAY_MS = 24 * 60 * 60 * 1000;
const RESOLVED_DAYS = 30;
const RESOLVED_PAGE = 50;

/** A live request with its item, as the read query returns it. */
type RawRow = {
  id: string;
  type: string;
  title: string;
  archived_at: string | Date | null;
  updated_at: string | Date;
  body: string | null;
  from_name: string | null;
  from_owner: boolean;
  source: string;
  source_handle: string | null;
  source_url: string | null;
  external_id: string | null;
  received_at: string | Date;
  actions: unknown;
  resolved_at: string | Date | null;
  outcome: string | null;
  appended_ids: string[];
};

const iso = (v: string | Date) => new Date(v).toISOString();

/** Live requests matching `where` (on `r`, the `requests` row), then `tail`. */
function rowsQuery(where: SQL, tail: SQL): SQL {
  return sql`
    select i.id, i.type, i.title, i.archived_at, i.updated_at,
      r.body, r.from_name, r.from_owner, r.source, r.source_handle, r.source_url,
      r.external_id, r.received_at, r.actions, r.resolved_at, r.outcome, r.appended_ids
    from requests r
    join items i on i.id = r.item_id and i.deleted_at is null
    where ${where}
    ${tail}`;
}

function toRow(r: RawRow): RequestRow {
  return toRequestRow(
    {
      id: r.id,
      type: r.type,
      title: r.title,
      // Not read by `toRequestRow`.
      createdAt: iso(r.updated_at),
      updatedAt: iso(r.updated_at),
      archivedAt: r.archived_at ? iso(r.archived_at) : null,
    },
    {
      itemId: r.id,
      body: r.body,
      fromName: r.from_name,
      fromOwner: r.from_owner,
      source: r.source,
      sourceHandle: r.source_handle,
      sourceUrl: r.source_url,
      externalId: r.external_id,
      receivedAt: new Date(r.received_at),
      actions: r.actions,
      resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
      outcome: r.outcome,
      appendedIds: r.appended_ids,
    },
  );
}

function notFound(): never {
  throw new TRPCError({ code: "NOT_FOUND", message: "request not found" });
}

const resolvedCursor = z.object({ resolvedAt: z.iso.datetime(), id: z.uuid() });

function encodeCursor(row: RequestRow): string {
  return Buffer.from(
    JSON.stringify({ resolvedAt: row.resolvedAt, id: row.id }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): z.infer<typeof resolvedCursor> {
  try {
    return resolvedCursor.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid cursor" });
  }
}

export const open = implementOperation(requestOps.open, {
  async run(deps) {
    const rows = await deps.db.execute<RawRow>(
      rowsQuery(
        sql`r.resolved_at is null and i.archived_at is null`,
        sql`order by r.received_at, r.item_id`,
      ),
    );
    return { heading: "Waiting on you", items: rows.map(toRow) };
  },
});

/** A resolved row, with the task a `task` outcome names (deleted or not). */
export type ResolvedRow = RequestRow & {
  task: { id: string; title: string; deleted: boolean } | null;
};

export const resolved = implementOperation(requestOps.resolved, {
  async run(
    deps,
    input,
  ): Promise<{ rows: ResolvedRow[]; nextCursor?: string }> {
    const since = new Date(deps.now().getTime() - RESOLVED_DAYS * DAY_MS);
    const after = input.cursor ? decodeCursor(input.cursor) : null;
    // Newest first; ties by id ascending, so the cursor compares both.
    const past = after
      ? sql`and (r.resolved_at < ${after.resolvedAt}::timestamptz
          or (r.resolved_at = ${after.resolvedAt}::timestamptz
            and r.item_id > ${after.id}::uuid))`
      : sql``;
    const kind = input.outcome ? sql`and r.outcome = ${input.outcome}` : sql``;
    const raw = await deps.db.execute<RawRow>(
      rowsQuery(
        sql`r.resolved_at >= ${since.toISOString()}::timestamptz ${kind} ${past}`,
        sql`order by r.resolved_at desc, r.item_id limit ${RESOLVED_PAGE + 1}`,
      ),
    );
    const page = raw.slice(0, RESOLVED_PAGE).map(toRow);
    const tasks = await requestTasks(
      deps.db,
      page.filter((r) => r.outcome === "task").map((r) => r.id),
    );
    const rows = page.map((r) => ({ ...r, task: tasks.get(r.id) ?? null }));
    const last = page[page.length - 1];
    return raw.length > RESOLVED_PAGE && last
      ? { rows, nextCursor: encodeCursor(last) }
      : { rows };
  },
});

export const get = implementOperation(requestOps.get, {
  async run(deps, input) {
    const [found] = await deps.db.execute<RawRow>(
      rowsQuery(sql`r.item_id = ${input.id}`, sql``),
    );
    if (!found) notFound();
    const request = toRow(found);
    const link = await requestTask(deps.db, request.id, request.outcome);
    if (!link) return { request, task: null };
    const [task] = await deps.db.execute<{ title: string }>(
      sql`select title from items where id = ${link.taskId}`,
    );
    return {
      request,
      task: {
        id: link.taskId,
        title: task?.title ?? "",
        deleted: link.taskDeleted,
      },
    };
  },
});

export const fromSender = implementOperation(requestOps.fromSender, {
  async run(deps, input) {
    const open = input.openOnly ? sql`and r.resolved_at is null` : sql``;
    const since = input.since
      ? sql`and r.received_at >= ${input.since.toISOString()}::timestamptz`
      : sql``;
    const raw = await deps.db.execute<RawRow>(
      rowsQuery(
        sql`r.source = 'slack' and r.source_handle = ${input.asker.slackUserId} ${open} ${since}`,
        sql`order by r.received_at desc, r.item_id`,
      ),
    );
    return raw.map((rawRow) => {
      const r = toRow(rawRow);
      return {
        id: r.id,
        title: r.title,
        body: r.body,
        sourceUrl: r.sourceUrl,
        externalId: r.externalId,
        receivedAt: r.receivedAt,
        outcome: r.outcome,
        resolvedAt: r.resolvedAt,
        appendedIds: rawRow.appended_ids,
      };
    });
  },
});
