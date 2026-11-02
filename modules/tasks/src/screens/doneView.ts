import { addDays, clock, type Day, todayIn } from "../dates";
import type { TaskRow } from "../schema";

export type DoneGroup = { day: Day; label: string; rows: TaskRow[] };

const dayLabel = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const weekday = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});
const noon = (day: Day) => new Date(`${day}T12:00:00Z`);

function describe(day: Day, today: Day): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return dayLabel.format(noon(day));
}

/**
 * Done rows (last completed first) grouped by the day they were completed in
 * `tz`: "Today", "Yesterday", then "Thu, Oct 29".
 */
export function groupDone(
  rows: TaskRow[],
  today: Day,
  tz: string,
): DoneGroup[] {
  const groups: DoneGroup[] = [];
  for (const row of rows) {
    if (!row.completedAt) continue;
    const day = todayIn(new Date(row.completedAt), tz);
    let group = groups[groups.length - 1];
    if (group?.day !== day) {
      group = { day, label: describe(day, today), rows: [] };
      groups.push(group);
    }
    group.rows.push(row);
  }
  return groups;
}

/** When a done row was completed, 24-hour in `tz`. */
export function doneTime(row: TaskRow, tz: string): string {
  return row.completedAt ? clock(new Date(row.completedAt), tz) : "";
}

/** `stats.perDay` as bars labelled by weekday. */
export function dayBars(
  perDay: { day: Day; count: number }[],
): { label: string; value: number }[] {
  return perDay.map((d) => ({
    label: weekday.format(noon(d.day)),
    value: d.count,
  }));
}
