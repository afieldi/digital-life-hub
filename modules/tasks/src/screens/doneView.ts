import {
  addDays,
  clock,
  type Day,
  fullDayLabel,
  todayIn,
  utcNoon,
  weekdayShort,
} from "@dlh/core";
import type { TaskRow } from "../schema";
import { parentLabel } from "./openView";

export type DoneGroup = { day: Day; label: string; rows: TaskRow[] };

function describe(day: Day, today: Day): string {
  if (day === today) return "Today";
  if (day === addDays(today, -1)) return "Yesterday";
  return fullDayLabel.format(utcNoon(day));
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

/**
 * What a done row shows under its title: when it was completed, 24-hour in
 * `tz`, and for a subtask its parent ("15:20 · in Plan the trip").
 */
export function doneMeta(row: TaskRow, tz: string): string {
  const time = row.completedAt ? clock(new Date(row.completedAt), tz) : "";
  const parent = parentLabel(row);
  return parent ? [time, parent].filter(Boolean).join(" · ") : time;
}

/** `stats.perDay` as bars labelled by weekday. */
export function dayBars(
  perDay: { day: Day; count: number }[],
): { label: string; value: number }[] {
  return perDay.map((d) => ({
    label: weekdayShort.format(utcNoon(d.day)),
    value: d.count,
  }));
}
