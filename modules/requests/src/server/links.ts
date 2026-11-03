import type { Item } from "@dlh/core";
import type { CoreDeps, Tx } from "@dlh/server";
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
 * The request's task and the `relates` link that names it. The link `resolve`
 * or `makeTask` wrote (`context = 'outcome'`) comes first. When there is none
 * and the request is resolved as `task`, its oldest `relates` link to a task:
 * resolving as a task the person had already linked by hand keeps that link
 * (links are unique per pair and kind), so it is the one that names the task.
 * Deleted tasks count; `taskDeleted` says so.
 */
export async function requestTask(
  tx: Tx | CoreDeps["db"],
  requestId: string,
  outcome: string | null,
): Promise<{
  linkId: string;
  taskId: string;
  taskDeleted: boolean;
  isOutcomeLink: boolean;
} | null> {
  const rows = await tx.execute<{
    link_id: string;
    task_id: string;
    task_deleted: boolean;
    is_outcome_link: boolean;
  }>(sql`
    select l.id as link_id, t.id as task_id, t.deleted_at is not null as task_deleted,
      l.context is not distinct from 'outcome' as is_outcome_link
    from links l
    join items t on t.id = l.to_id and t.type = 'task'
    where l.from_id = ${requestId} and l.kind = 'relates'
      and (l.context = 'outcome' or ${outcome} = 'task')
    order by (l.context is not distinct from 'outcome') desc, l.created_at, l.id
    limit 1`);
  const r = rows[0];
  return r
    ? {
        linkId: r.link_id,
        taskId: r.task_id,
        taskDeleted: r.task_deleted,
        isOutcomeLink: r.is_outcome_link,
      }
    : null;
}

/**
 * The task each request was resolved as, for requests whose outcome is
 * `task`: one query for a page of rows, picking the link as `requestTask` does.
 */
export async function requestTasks(
  db: CoreDeps["db"],
  requestIds: string[],
): Promise<Map<string, { id: string; title: string; deleted: boolean }>> {
  if (requestIds.length === 0) return new Map();
  const rows = await db.execute<{
    request_id: string;
    task_id: string;
    title: string;
    task_deleted: boolean;
  }>(sql`
    select distinct on (l.from_id) l.from_id as request_id, t.id as task_id,
      t.title, t.deleted_at is not null as task_deleted
    from links l
    join items t on t.id = l.to_id and t.type = 'task'
    where l.from_id in (${sql.join(
      requestIds.map((id) => sql`${id}::uuid`),
      sql`, `,
    )}) and l.kind = 'relates'
    order by l.from_id, (l.context is not distinct from 'outcome') desc,
      l.created_at, l.id`);
  return new Map(
    rows.map((r) => [
      r.request_id,
      { id: r.task_id, title: r.title, deleted: r.task_deleted },
    ]),
  );
}
