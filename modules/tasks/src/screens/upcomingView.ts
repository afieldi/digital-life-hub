import { addDays, clock, type Day, utcNoon, weekdayShort } from "@dlh/core";
import { dueHeading } from "../dates";
import type { TaskRow } from "../schema";

const fullDay = new Intl.DateTimeFormat("en-US", {
  weekday: "long",
  month: "long",
  day: "numeric",
  timeZone: "UTC",
});

export type WeekColumn = { id: Day; title: string; full: string };

/** The seven days from `weekStart` (a Monday), titled like "Thu 5". */
export function weekColumns(weekStart: Day): WeekColumn[] {
  return Array.from({ length: 7 }, (_, n) => {
    const id = addDays(weekStart, n);
    return {
      id,
      title: `${weekdayShort.format(utcNoon(id))} ${Number(id.slice(8))}`,
      full: fullDay.format(utcNoon(id)),
    };
  });
}

/** "Nov 2 – 8", "Nov 30 – Dec 6". */
export function weekLabel(weekStart: Day): string {
  return dueHeading(weekStart, addDays(weekStart, 7)).replace(/^Due /, "");
}

/** Rows due in the week starting `weekStart`, and those after it. */
export function splitUpcoming(
  rows: TaskRow[],
  weekStart: Day,
): { week: TaskRow[]; later: TaskRow[] } {
  const end = addDays(weekStart, 7);
  const week: TaskRow[] = [];
  const later: TaskRow[] = [];
  for (const row of rows) {
    if (row.day === null || row.day < weekStart) continue;
    (row.day < end ? week : later).push(row);
  }
  return { week, later };
}

/** A card's time in `tz` ("9:00"), or "Any time" for a day-only task. */
export function cardWhen(row: TaskRow, tz: string): string {
  return row.due && "dateTime" in row.due
    ? clock(new Date(row.due.dateTime), tz)
    : "Any time";
}

/**
 * Where a card dropped at `index` goes, given the other cards' ids in the
 * column it lands in: first, or after the card before it.
 */
export function dropPosition(
  others: string[],
  index: number,
): "top" | { after: string } {
  const before = others[Math.min(index, others.length) - 1];
  return before === undefined ? "top" : { after: before };
}
