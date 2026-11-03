import {
  addDays,
  type Day,
  dayOfDue,
  instantBounds,
  todayIn,
  weekStartOf,
} from "@dlh/core";
import { type CoreDeps, implementOperation, type Tx } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { type SQL, sql } from "drizzle-orm";
import { z } from "zod";
import { dueHeading } from "../dates";
import { taskOps } from "../operations";
import { priority, type TaskRow } from "../schema";
import { type SummaryRow, toSummary } from "./links";

type Db = CoreDeps["db"] | Tx;

function badRequest(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}

/** A `tasks` row with its item, as the read query returns it. */
type RawRow = {
  id: string;
  title: string;
  updated_at: string | Date;
  archived_at: string | Date | null;
  completed_at: string | Date | null;
  due_date: string | null;
  due_at: string | Date | null;
  due_tz: string | null;
  priority: string;
  notes: string | null;
  sort_key: string;
  sub_total: number;
  sub_done: number;
  sub_next: string | null;
  parents: SummaryRow[];
  linked_notes: number;
};

const iso = (v: string | Date) => new Date(v).toISOString();

/**
 * Live tasks matching `where` (on `t`, the `tasks` row), each with its subtask
 * summary, live task parents in link order and linked note count. Deleted items
 * and links to them don't count.
 */
function rowsQuery(where: SQL, tail: SQL = sql``): SQL {
  return sql`
    select t.item_id as id, i.title, i.updated_at, i.archived_at,
      t.completed_at, t.due_date::text as due_date, t.due_at, t.due_tz,
      t.priority, t.notes, t.sort_key,
      st.total as sub_total, st.done as sub_done, st.next as sub_next,
      pa.parents, ln.linked_notes
    from tasks t
    join items i on i.id = t.item_id and i.deleted_at is null
    cross join lateral (
      select count(*)::int as total,
        count(*) filter (where s.completed_at is not null)::int as done,
        (array_agg(si.title order by s.sort_key, s.item_id)
          filter (where s.completed_at is null))[1] as next
      from links l
      join items si on si.id = l.to_id and si.deleted_at is null
      join tasks s on s.item_id = si.id
      where l.from_id = t.item_id and l.kind = 'contains'
    ) st
    cross join lateral (
      select coalesce(json_agg(json_build_object(
          'id', p.id, 'type', p.type, 'title', p.title,
          'archived_at', p.archived_at)
        order by l.created_at, l.id), '[]'::json) as parents
      from links l
      join items p on p.id = l.from_id and p.deleted_at is null
      join tasks pt on pt.item_id = p.id
      where l.to_id = t.item_id and l.kind = 'contains'
    ) pa
    cross join lateral (
      select count(distinct n.id)::int as linked_notes
      from links l
      join items n on n.id in (l.from_id, l.to_id) and n.id <> t.item_id
        and n.type = 'note' and n.deleted_at is null
      where l.from_id = t.item_id or l.to_id = t.item_id
    ) ln
    where ${where}
    ${tail}`;
}

/** Not a subtask with no due: those show only on their parents. */
const shownOnItsOwn = sql`(
  t.due_date is not null or t.due_at is not null
  or not exists (
    select 1 from links l
    join items p on p.id = l.from_id and p.deleted_at is null
    join tasks pt on pt.item_id = p.id
    where l.to_id = t.item_id and l.kind = 'contains'
  ))`;

function toTaskRow(r: RawRow, tz: string): TaskRow {
  const dueAt = r.due_at ? iso(r.due_at) : null;
  const due = r.due_date
    ? { date: r.due_date }
    : dueAt
      ? r.due_tz
        ? { dateTime: dueAt, timeZone: r.due_tz }
        : { dateTime: dueAt }
      : null;
  return {
    id: r.id,
    title: r.title,
    updatedAt: iso(r.updated_at),
    completedAt: r.completed_at ? iso(r.completed_at) : null,
    due,
    priority: priority.parse(r.priority),
    notes: r.notes,
    day: dayOfDue(due, tz),
    subtasks: { total: r.sub_total, done: r.sub_done, next: r.sub_next },
    parents: r.parents.map(toSummary),
    linkedNotes: r.linked_notes,
    sortKey: r.sort_key,
  };
}

async function readRows(
  db: Db,
  query: SQL,
  tz: string,
): Promise<{ row: TaskRow; archivedAt: string | null }[]> {
  const raw = await db.execute<RawRow>(query);
  return raw.map((r) => ({
    row: toTaskRow(r, tz),
    archivedAt: r.archived_at ? iso(r.archived_at) : null,
  }));
}

/** Fractional keys order by byte, as the column's "C" collation does. */
const byKey = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * By day (no day last); within a day timed tasks first by their moment, then
 * any-time tasks by sort key. With no day, by sort key.
 */
function compareRows(a: TaskRow, b: TaskRow): number {
  if (a.day !== b.day) {
    if (a.day === null) return 1;
    if (b.day === null) return -1;
    return byKey(a.day, b.day);
  }
  const at = a.due && "dateTime" in a.due ? Date.parse(a.due.dateTime) : null;
  const bt = b.due && "dateTime" in b.due ? Date.parse(b.due.dateTime) : null;
  if (at !== null && bt !== null && at !== bt) return at - bt;
  if (at !== null && bt === null) return -1;
  if (at === null && bt !== null) return 1;
  return byKey(a.sortKey, b.sortKey) || byKey(a.id, b.id);
}

type Range = {
  from: Day;
  to: Day;
  timeZone: string;
  include: "open" | "all";
};

/**
 * Tasks due from `from` up to (not including) `to` in `timeZone`. The day-only
 * and timed halves each compare their own column, so with `include: "open"`
 * each uses its partial index.
 */
export function dueBetweenQuery({ from, to, timeZone, include }: Range): SQL {
  const bounds = instantBounds(from, to, timeZone);
  const open = include === "open" ? sql`t.completed_at is null and` : sql``;
  return rowsQuery(sql`${open} (
       t.due_date >= ${from}::date and t.due_date < ${to}::date
    or t.due_at >= ${bounds.from.toISOString()}::timestamptz
       and t.due_at < ${bounds.to.toISOString()}::timestamptz)`);
}

/** `dueBetween`, with each row's `archivedAt` for item summaries. */
export async function dueBetweenRows(db: Db, range: Range) {
  const rows = await readRows(db, dueBetweenQuery(range), range.timeZone);
  return rows.sort((a, b) => compareRows(a.row, b.row));
}

export async function dueBetween(db: Db, range: Range): Promise<TaskRow[]> {
  return (await dueBetweenRows(db, range)).map((r) => r.row);
}

/** The live tasks among `ids`, done or not, each with its item's `archivedAt`. */
export async function rowsByIds(db: Db, ids: string[], tz: string) {
  if (ids.length === 0) return [];
  return readRows(
    db,
    rowsQuery(
      sql`t.item_id in (${sql.join(
        ids.map((id) => sql`${id}::uuid`),
        sql`, `,
      )})`,
    ),
    tz,
  );
}

/** Open tasks, and those done since today started in `tz`. */
async function openRows(db: Db, now: Date, tz: string): Promise<TaskRow[]> {
  const today = todayIn(now, tz);
  const start = instantBounds(today, today, tz).from.toISOString();
  const rows = await readRows(
    db,
    rowsQuery(sql`(t.completed_at is null
      or t.completed_at >= ${start}::timestamptz) and ${shownOnItsOwn}`),
    tz,
  );
  return rows.map((r) => r.row).sort(compareRows);
}

/** Open tasks due in the week holding `weekOf`, or later. */
async function upcomingRows(
  db: Db,
  weekOf: Day,
  tz: string,
): Promise<TaskRow[]> {
  const from = weekStartOf(weekOf);
  const start = instantBounds(from, from, tz).from.toISOString();
  const rows = await readRows(
    db,
    rowsQuery(sql`t.completed_at is null and (
      t.due_date >= ${from}::date or t.due_at >= ${start}::timestamptz)`),
    tz,
  );
  return rows.map((r) => r.row).sort(compareRows);
}

const DONE_PAGE = 50;

const doneCursor = z.object({ completedAt: z.iso.datetime(), id: z.uuid() });

function encodeCursor(row: TaskRow): string {
  return Buffer.from(
    JSON.stringify({ completedAt: row.completedAt, id: row.id }),
  ).toString("base64url");
}

function decodeCursor(cursor: string): z.infer<typeof doneCursor> {
  try {
    return doneCursor.parse(
      JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")),
    );
  } catch {
    badRequest("invalid cursor");
  }
}

/**
 * Done tasks, last completed first, a page at a time. Done is a history of
 * completions, so undated subtasks are listed too (with their parents), as
 * `stats` counts them.
 */
async function doneRows(
  db: Db,
  tz: string,
  cursor: string | undefined,
): Promise<{ rows: TaskRow[]; nextCursor?: string }> {
  const after = cursor ? decodeCursor(cursor) : null;
  const before = after
    ? sql`and (t.completed_at, t.item_id) < (${after.completedAt}::timestamptz, ${after.id}::uuid)`
    : sql``;
  const rows = await readRows(
    db,
    rowsQuery(
      sql`t.completed_at is not null ${before}`,
      sql`order by t.completed_at desc, t.item_id desc limit ${DONE_PAGE + 1}`,
    ),
    tz,
  );
  const page = rows.slice(0, DONE_PAGE).map((r) => r.row);
  const last = page[page.length - 1];
  return rows.length > DONE_PAGE && last
    ? { rows: page, nextCursor: encodeCursor(last) }
    : { rows: page };
}

export const due = implementOperation(taskOps.due, {
  async run(deps, input) {
    if (input.to <= input.from) badRequest("`to` must be after `from`");
    const rows = await dueBetweenRows(deps.db, {
      ...input,
      include: input.include ?? "open",
    });
    return {
      heading: dueHeading(input.from, input.to),
      items: rows.map(({ row, archivedAt }) => ({
        ...row,
        type: "task",
        archivedAt,
      })),
    };
  },
});

export const list = implementOperation(taskOps.list, {
  async run(deps, input): Promise<{ rows: TaskRow[]; nextCursor?: string }> {
    const tz = input.timeZone;
    if (input.view === "open") {
      return { rows: await openRows(deps.db, deps.now(), tz) };
    }
    if (input.view === "upcoming") {
      if (!input.weekOf) badRequest("upcoming needs weekOf");
      return { rows: await upcomingRows(deps.db, input.weekOf, tz) };
    }
    return doneRows(deps.db, tz, input.cursor);
  },
});

export const get = implementOperation(taskOps.get, {
  async run(deps, input) {
    const [found] = await deps.db.execute<RawRow>(
      rowsQuery(sql`t.item_id = ${input.id}`),
    );
    if (!found) {
      throw new TRPCError({ code: "NOT_FOUND", message: "task not found" });
    }
    const tz = input.timeZone ?? found.due_tz ?? "UTC";
    const subtasks = await readRows(
      deps.db,
      rowsQuery(
        sql`exists (
          select 1 from links l
          where l.from_id = ${input.id} and l.kind = 'contains'
            and l.to_id = t.item_id)`,
        sql`order by t.sort_key, t.item_id`,
      ),
      tz,
    );
    const task = toTaskRow(found, tz);
    return {
      task,
      subtasks: subtasks.map((r) => r.row),
      parents: task.parents,
    };
  },
});

export const stats = implementOperation(taskOps.stats, {
  async run(deps, input) {
    const tz = input.timeZone;
    const weekStart = weekStartOf(input.weekOf);
    const lastWeekStart = addDays(weekStart, -7);
    const bounds = instantBounds(lastWeekStart, addDays(weekStart, 7), tz);
    const done = await deps.db.execute<{
      completed_at: string | Date;
      due_date: string | null;
      due_at: string | Date | null;
    }>(sql`
      select t.completed_at, t.due_date::text as due_date, t.due_at
      from tasks t
      join items i on i.id = t.item_id and i.deleted_at is null
      where t.completed_at >= ${bounds.from.toISOString()}::timestamptz
        and t.completed_at < ${bounds.to.toISOString()}::timestamptz`);

    const days = Array.from({ length: 7 }, (_, n) => addDays(weekStart, n));
    const perDay = new Map(days.map((d) => [d, 0]));
    let onTime = 0;
    let overdueCleared = 0;
    let lastWeek = 0;
    for (const r of done) {
      const doneDay = todayIn(new Date(r.completed_at), tz);
      if (doneDay < weekStart) {
        lastWeek++;
        continue;
      }
      perDay.set(doneDay, (perDay.get(doneDay) ?? 0) + 1);
      const dueDay = r.due_date
        ? r.due_date
        : r.due_at
          ? todayIn(new Date(r.due_at), tz)
          : null;
      if (dueDay === null) continue;
      if (doneDay <= dueDay) onTime++;
      else overdueCleared++;
    }
    return {
      perDay: days.map((day) => ({ day, count: perDay.get(day) ?? 0 })),
      done: done.length - lastWeek,
      onTime,
      overdueCleared,
      lastWeek,
    };
  },
});
