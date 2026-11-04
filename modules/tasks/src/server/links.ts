import type { ItemSummary } from "@dlh/core";
import {
  type CoreDeps,
  type RawSummaryRow,
  summaryFromRaw,
  type Tx,
} from "@dlh/server";
import { sql } from "drizzle-orm";

// Read-only queries on Core's `items` and `links`, by table name: modules can't
// import Core's tables, and the subtask rules need joins Core's read helpers
// don't offer. Writes to Core tables go through the writer only.
//
// A "task" here is a live item with a row in `tasks`; a subtask is a task that a
// live task `contains`.

/** Whether a live task contains `id`. */
export async function hasTaskParent(
  tx: Tx | CoreDeps["db"],
  id: string,
): Promise<boolean> {
  const rows = await tx.execute<{ found: boolean }>(sql`
    select exists (
      select 1 from links l
      join items p on p.id = l.from_id and p.deleted_at is null
      join tasks t on t.item_id = p.id
      where l.to_id = ${id} and l.kind = 'contains'
    ) as found`);
  return rows[0]?.found ?? false;
}

/** Whether `id` contains a live task. */
export async function hasTaskSubtasks(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.execute<{ found: boolean }>(sql`
    select exists (
      select 1 from links l
      join items s on s.id = l.to_id and s.deleted_at is null
      join tasks t on t.item_id = s.id
      where l.from_id = ${id} and l.kind = 'contains'
    ) as found`);
  return rows[0]?.found ?? false;
}

/** Open task parents of `id` whose live subtasks are now all done, in link order. */
export async function parentsNowDone(
  tx: Tx,
  id: string,
): Promise<ItemSummary[]> {
  const rows = await tx.execute<RawSummaryRow>(sql`
    select p.id, p.type, p.title, p.archived_at
    from links l
    join items p on p.id = l.from_id and p.deleted_at is null
    join tasks pt on pt.item_id = p.id and pt.completed_at is null
    where l.to_id = ${id} and l.kind = 'contains'
      and not exists (
        select 1 from links l2
        join items s on s.id = l2.to_id and s.deleted_at is null
        join tasks st on st.item_id = s.id and st.completed_at is null
        where l2.from_id = p.id and l2.kind = 'contains'
      )
    order by l.created_at, l.id`);
  return rows.map(summaryFromRaw);
}

/**
 * Task subtasks of `id`. With `onlyUnshared`, only live ones that no other live
 * task contains.
 */
export async function subtaskIds(
  tx: Tx,
  id: string,
  { onlyUnshared }: { onlyUnshared: boolean },
): Promise<string[]> {
  const unshared = sql`
    and s.deleted_at is null
    and not exists (
      select 1 from links o
      join items p on p.id = o.from_id and p.deleted_at is null
      join tasks pt on pt.item_id = p.id
      where o.to_id = s.id and o.kind = 'contains' and o.from_id <> ${id}
    )`;
  const rows = await tx.execute<{ id: string }>(sql`
    select s.id from links l
    join items s on s.id = l.to_id
    join tasks t on t.item_id = s.id
    where l.from_id = ${id} and l.kind = 'contains'
    ${onlyUnshared ? unshared : sql``}`);
  return rows.map((r) => r.id);
}

/** Whether a live task that contains `id` is itself inside a live task. */
export async function hasTaskGrandparent(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.execute<{ found: boolean }>(sql`
    select exists (
      select 1 from links l
      join items p on p.id = l.from_id and p.deleted_at is null
      join tasks t on t.item_id = p.id
      join links l2 on l2.to_id = p.id and l2.kind = 'contains'
      join items g on g.id = l2.from_id and g.deleted_at is null
      join tasks tg on tg.item_id = g.id
      where l.to_id = ${id} and l.kind = 'contains'
    ) as found`);
  return rows[0]?.found ?? false;
}
