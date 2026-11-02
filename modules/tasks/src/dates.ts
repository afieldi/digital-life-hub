import type { Due } from "@dlh/core";
import {
  CalendarDateTime,
  fromDate,
  parseAbsolute,
  parseDate,
  startOfWeek,
  toCalendarDate,
  toZoned,
} from "@internationalized/date";

/** A day is a `YYYY-MM-DD` string. Weeks start on Monday. */
export type Day = string;

export type DueGroup = "overdue" | "today" | "week" | "later" | "none";

const WEEK_LOCALE = "en-GB"; // Monday-first

/** Today's day in `tz`. */
export function todayIn(now: Date, tz: string): Day {
  return toCalendarDate(fromDate(now, tz)).toString();
}

/** The Monday of the week that holds `day`. */
export function weekStartOf(day: Day): Day {
  return startOfWeek(parseDate(day), WEEK_LOCALE).toString();
}

export function addDays(day: Day, n: number): Day {
  return parseDate(day).add({ days: n }).toString();
}

/** The day a due falls on in `tz`. A day-only due is the same day in every zone. */
export function dayOfDue(due: Due | null, tz: string): Day | null {
  if (!due) return null;
  if ("date" in due) return due.date;
  return toCalendarDate(fromDate(new Date(due.dateTime), tz)).toString();
}

/** The instants where `from` starts and `to` starts in `tz`: a half-open range. */
export function instantBounds(
  from: Day,
  to: Day,
  tz: string,
): { from: Date; to: Date } {
  return { from: parseDate(from).toDate(tz), to: parseDate(to).toDate(tz) };
}

/** Where a day sits relative to today's week. `none` is no day at all. */
export function groupFor(day: Day | null, today: Day): DueGroup {
  if (day === null) return "none";
  if (day < today) return "overdue";
  if (day === today) return "today";
  return day < addDays(weekStartOf(today), 7) ? "week" : "later";
}

/**
 * The same due on another day. A day-only due just changes day. A timed due
 * keeps its wall-clock time in the zone it was set in (or `tz` when it has none),
 * so the offset is re-read for the new day.
 */
export function moveToDay(due: Due, day: Day, tz: string): Due {
  if ("date" in due) return { date: day };
  const zone = due.timeZone ?? tz;
  const target = parseDate(day);
  const at = parseAbsolute(due.dateTime, zone);
  const moved = toZoned(
    new CalendarDateTime(
      target.year,
      target.month,
      target.day,
      at.hour,
      at.minute,
      at.second,
      at.millisecond,
    ),
    zone,
  );
  const dateTime = moved.toString().replace(/\[.*\]$/, "");
  return due.timeZone ? { dateTime, timeZone: due.timeZone } : { dateTime };
}

const dayLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
const dayLabelYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});
const weekdayLabel = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});

function utcNoon(day: Day): Date {
  return parseDate(day).toDate("UTC");
}

function describeDay(day: Day, today: Day): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  if (day > today && day < addDays(today, 7)) {
    return weekdayLabel.format(utcNoon(day));
  }
  return day.slice(0, 4) === today.slice(0, 4)
    ? dayLabel.format(utcNoon(day))
    : dayLabelYear.format(utcNoon(day));
}

function clock(date: Date, tz: string, withPeriod: boolean): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: tz,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const time = `${get("hour")}:${get("minute")}`;
  return withPeriod ? `${time} ${get("dayPeriod")}` : time;
}

/** "PST" and "PDT" read as "PT"; other zones keep Intl's short name. */
function zoneAbbreviation(date: Date, tz: string): string {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone: tz, timeZoneName: "short" })
      .formatToParts(date)
      .find((p) => p.type === "timeZoneName")?.value ?? tz;
  return name.replace(/^([PMCE])[SD]T$/, "$1T");
}

/**
 * What a row shows: the day (and time, in `tz`). When the time was set in another
 * zone, `origin` says what it was there, like "9:00 PT". An origin in the afternoon
 * carries "PM"; mornings omit "AM".
 */
export function formatWhen(
  due: Due,
  tz: string,
  today: Day,
): { text: string; origin?: string } {
  const day = describeDay(dayOfDue(due, tz) as Day, today);
  if ("date" in due) return { text: day };
  const instant = new Date(due.dateTime);
  const text = `${day} ${clock(instant, tz, true)}`;
  if (!due.timeZone || due.timeZone === tz) return { text };
  const time = clock(instant, due.timeZone, false);
  const pm = clock(instant, due.timeZone, true).endsWith("PM");
  return {
    text,
    origin: `${time}${pm ? " PM" : ""} ${zoneAbbreviation(instant, due.timeZone)}`,
  };
}
