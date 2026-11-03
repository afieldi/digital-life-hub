import type { Item } from "@dlh/core";
import type { Tx } from "@dlh/server";
import { sql } from "drizzle-orm";

// Read-only queries on Core's `items` and `links`, by table name: modules can't
// import Core's tables, and these reads include deleted items, which Core's
// read helpers leave out. Writes to Core tables go through the writer only.

/** The live item's type, or null when it is missing or deleted. */
export async function liveType(tx: Tx, id: string): Promise<string | null> {
  const rows = await tx.execute<{ type: string }>(
    sql`select type from items where id = ${id} and deleted_at is null`,
  );
  return rows[0]?.type ?? null;
}

const iso = (v: string | Date) => new Date(v).toISOString();

/** The item, deleted or not; null when there is no such row. */
export async function anyItem(tx: Tx, id: string): Promise<Item | null> {
  const rows = await tx.execute<{
    id: string;
    type: string;
    title: string;
    created_at: string | Date;
    updated_at: string | Date;
    archived_at: string | Date | null;
  }>(sql`
    select id, type, title, created_at, updated_at, archived_at
    from items where id = ${id}`);
  const r = rows[0];
  if (!r) return null;
  return {
    id: r.id,
    type: r.type,
    title: r.title,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
    archivedAt: r.archived_at ? iso(r.archived_at) : null,
  };
}

/**
 * The `relates` link that `resolve` or `makeTask` wrote from the request to its
 * task (`context = 'outcome'`), including one to a deleted task. A link the
 * person added by hand has another context and is never this one.
 */
export async function outcomeLink(
  tx: Tx,
  requestId: string,
): Promise<{ linkId: string; taskId: string; taskDeleted: boolean } | null> {
  const rows = await tx.execute<{
    link_id: string;
    task_id: string;
    task_deleted: boolean;
  }>(sql`
    select l.id as link_id, t.id as task_id, t.deleted_at is not null as task_deleted
    from links l
    join items t on t.id = l.to_id and t.type = 'task'
    where l.from_id = ${requestId} and l.kind = 'relates' and l.context = 'outcome'
    order by l.created_at, l.id
    limit 1`);
  const r = rows[0];
  return r
    ? { linkId: r.link_id, taskId: r.task_id, taskDeleted: r.task_deleted }
    : null;
}
