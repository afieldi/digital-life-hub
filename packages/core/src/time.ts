import {
  CalendarDateTime,
  fromDate,
  parseAbsolute,
  parseDate,
  startOfWeek,
  toCalendarDate,
  toZoned,
} from "@internationalized/date";
import { z } from "zod";
import type { Due } from "./operations/due";

/** A day is a `YYYY-MM-DD` string. Weeks start on Monday. */
export type Day = string;

/** A `YYYY-MM-DD` day. */
export const dayValue = z.iso.date();

/** Whether `tz` is an IANA zone this runtime knows. */
export function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** An IANA time zone this runtime knows. */
export const timeZoneValue = z
  .string()
  .max(100)
  .refine(isTimeZone, "Unknown time zone");

/** The zone this device (or server process) runs in. */
export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

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

/**
 * The same due on another day, as `tz` sees days: a day-only due just changes
 * day; a timed due keeps the wall-clock time it shows in `tz` (the zone the
 * days are read in, e.g. the device's), re-reading the offset for the new day,
 * so it lands on `day` in `tz`. The zone it was set in is kept as it was.
 */
export function moveToDay(due: Due, day: Day, tz: string): Due {
  if ("date" in due) return { date: day };
  const target = parseDate(day);
  const at = parseAbsolute(due.dateTime, tz);
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
    tz,
  );
  const dateTime = moved.toString().replace(/\[.*\]$/, "");
  return due.timeZone ? { dateTime, timeZone: due.timeZone } : { dateTime };
}

/** "Nov 6". */
export const dayLabel = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});
/** "Nov 6, 2027". */
export const dayLabelYear = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Noon UTC on `day`: format it with `timeZone: "UTC"` to show that day anywhere. */
export function utcNoon(day: Day): Date {
  return new Date(`${day}T12:00:00Z`);
}

/** "Thu": a day's short weekday. */
export const weekdayShort = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  timeZone: "UTC",
});

function describeDay(day: Day, today: Day): string {
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  if (day > today && day < addDays(today, 7)) {
    return weekdayShort.format(utcNoon(day));
  }
  return day.slice(0, 4) === today.slice(0, 4)
    ? dayLabel.format(utcNoon(day))
    : dayLabelYear.format(utcNoon(day));
}

/** The 24-hour wall time of `date` in `tz`, like "9:00". */
export function clock(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: tz,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${Number(get("hour"))}:${get("minute")}`;
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
 * What a row shows: the day and the 24-hour time in `tz`, like "Today 14:00". When
 * the time was set in another zone, `origin` says what it was there, like "9:00 PT".
 */
export function formatWhen(
  due: Due,
  tz: string,
  today: Day,
): { text: string; origin?: string } {
  const day = describeDay(dayOfDue(due, tz) as Day, today);
  if ("date" in due) return { text: day };
  const instant = new Date(due.dateTime);
  const text = `${day} ${clock(instant, tz)}`;
  if (!due.timeZone || due.timeZone === tz) return { text };
  return {
    text,
    origin: `${clock(instant, due.timeZone)} ${zoneAbbreviation(instant, due.timeZone)}`,
  };
}

/** "Fri, Nov 6". */
export const fullDayLabel = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

/**
 * A due without a "today" to compare against, as an operation's summary shows
 * it: "Fri, Nov 6", or "Fri, Nov 6 9:00" at the wall time it was set at (in
 * its zone, or as its offset reads when it has none).
 */
export function formatDue(due: Due): string {
  if ("date" in due) return fullDayLabel.format(utcNoon(due.date));
  if (due.timeZone) {
    const instant = new Date(due.dateTime);
    const day = todayIn(instant, due.timeZone);
    return `${fullDayLabel.format(utcNoon(day))} ${clock(instant, due.timeZone)}`;
  }
  const day = fullDayLabel.format(utcNoon(due.dateTime.slice(0, 10)));
  const [hour = "0", minute = "00"] = due.dateTime.slice(11, 16).split(":");
  return `${day} ${Number(hour)}:${minute}`;
}
