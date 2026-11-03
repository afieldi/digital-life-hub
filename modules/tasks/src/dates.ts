import {
  addDays,
  type Day,
  dayLabel,
  dayLabelYear,
  fullDayLabel,
  utcNoon,
  weekStartOf,
} from "@dlh/core";

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

/** Where a day sits relative to today's week. `none` is no day at all. */
export function groupFor(day: Day | null, today: Day): DueGroup {
  if (day === null) return "none";
  if (day < today) return "overdue";
  if (day === today) return "today";
  return day < addDays(weekStartOf(today), 7) ? "week" : "later";
}

/**
 * The heading for tasks due from `from` up to (not including) `to`: one day is
 * "Due Fri, Nov 6"; a range names its last day, "Due Nov 2 – 8".
 */
export function dueHeading(from: Day, to: Day): string {
  const last = addDays(to, -1);
  if (last <= from) return `Due ${fullDayLabel.format(utcNoon(from))}`;
  const start = utcNoon(from);
  const end = utcNoon(last);
  if (from.slice(0, 4) !== last.slice(0, 4)) {
    return `Due ${dayLabelYear.format(start)} – ${dayLabelYear.format(end)}`;
  }
  const endText =
    from.slice(0, 7) === last.slice(0, 7)
      ? String(Number(last.slice(8)))
      : dayLabel.format(end);
  return `Due ${dayLabel.format(start)} – ${endText}`;
}
