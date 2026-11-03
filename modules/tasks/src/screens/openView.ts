import { clock, type Day, formatWhen, todayIn } from "@dlh/core";
import { type DueGroup, groupFor } from "../dates";
import type { TaskRow } from "../schema";

export type OpenGroup = { key: DueGroup; label: string; rows: TaskRow[] };

const ORDER: { key: DueGroup; label: string; always: boolean }[] = [
  { key: "overdue", label: "Overdue", always: false },
  { key: "today", label: "Today", always: true },
  { key: "week", label: "This week", always: true },
  { key: "later", label: "Later", always: false },
  { key: "none", label: "No date", always: true },
];

/**
 * The Open screen's groups, in the list's order. Tasks done today (the only
 * done ones the open view returns) stay in Today. Overdue and Later show only
 * when they hold something.
 */
export function groupOpenRows(
  rows: TaskRow[],
  today: Day,
  { highOnly }: { highOnly: boolean },
): OpenGroup[] {
  const byKey = new Map<DueGroup, TaskRow[]>(ORDER.map((g) => [g.key, []]));
  for (const row of rows) {
    if (highOnly && row.priority !== "high") continue;
    const key = row.completedAt ? "today" : groupFor(row.day, today);
    byKey.get(key)?.push(row);
  }
  return ORDER.flatMap(({ key, label, always }) => {
    const groupRows = byKey.get(key) ?? [];
    return always || groupRows.length > 0
      ? [{ key, label, rows: groupRows }]
      : [];
  });
}

const inToday = (row: TaskRow, today: Day) =>
  row.completedAt !== null || row.day === today;

/** Today's tasks, and how many of them are done. */
export function todayProgress(
  rows: TaskRow[],
  today: Day,
): { done: number; total: number } {
  const todays = rows.filter((r) => inToday(r, today));
  return {
    done: todays.filter((r) => r.completedAt !== null).length,
    total: todays.length,
  };
}

/** The first open timed task due today that hasn't started yet. */
export function nextUp(
  rows: TaskRow[],
  now: Date,
  tz: string,
): { time: string; title: string } | null {
  const today = todayIn(now, tz);
  let best: { at: number; row: TaskRow } | null = null;
  for (const row of rows) {
    if (row.completedAt || row.day !== today || !row.due) continue;
    if (!("dateTime" in row.due)) continue;
    const at = Date.parse(row.due.dateTime);
    if (at < now.getTime()) continue;
    if (!best || at < best.at) best = { at, row };
  }
  return best
    ? { time: clock(new Date(best.at), tz), title: best.row.title }
    : null;
}

/** "in Plan the trip", "+N" for more parents; null for a task with none. */
export function parentLabel(row: TaskRow): string | null {
  const [parent, ...others] = row.parents;
  if (!parent) return null;
  return others.length > 0
    ? `in ${parent.title} +${others.length}`
    : `in ${parent.title}`;
}

/**
 * What a row shows under its title: when ("Today 12:00 · 9:00 PT" when set in
 * another zone), its subtasks, the parent of a dated subtask, linked notes.
 */
export function rowMeta(row: TaskRow, today: Day, tz: string): string[] {
  const parts: string[] = [];
  if (row.due) {
    const when = formatWhen(row.due, tz, today);
    parts.push(when.origin ? `${when.text} · ${when.origin}` : when.text);
  }
  const { total, done, next } = row.subtasks;
  if (total > 0)
    parts.push(next ? `${done}/${total} · Next: ${next}` : `${done}/${total}`);
  const parent = parentLabel(row);
  if (parent) parts.push(parent);
  if (row.linkedNotes > 0) {
    parts.push(
      `${row.linkedNotes} ${row.linkedNotes === 1 ? "note" : "notes"}`,
    );
  }
  return parts;
}

const open = (row: TaskRow) => row.completedAt === null;

/**
 * The line under "Tasks" on Open: "2 things left today · 1 overdue". With
 * nothing left today it says "Today is clear"; no overdue part when none are.
 */
export function openStatus(rows: TaskRow[], today: Day): string {
  const left = rows.filter((r) => open(r) && r.day === today).length;
  const overdue = rows.filter(
    (r) => open(r) && groupFor(r.day, today) === "overdue",
  ).length;
  const head =
    left === 0
      ? "Today is clear"
      : `${left} ${left === 1 ? "thing" : "things"} left today`;
  return overdue > 0 ? `${head} · ${overdue} overdue` : head;
}

/** The Open tab's count: tasks not done. */
export function openCount(rows: TaskRow[]): number {
  return rows.filter(open).length;
}

/** The Upcoming tab's count: open tasks due today or later. */
export function comingUpCount(rows: TaskRow[], today: Day): number {
  return rows.filter((r) => open(r) && r.day !== null && r.day >= today).length;
}
