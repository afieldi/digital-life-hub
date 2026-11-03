import {
  CalendarDate,
  CalendarDateTime,
  fromDate,
  toZoned,
} from "@internationalized/date";
import * as chrono from "chrono-node";
import type { Due } from "./operations/due";

/** When typed text is read: dates count forward from `now`, in `timeZone`. */
export type CaptureContext = { now: Date; timeZone: string };

/** A due found in text, with where it was. */
export type FoundDue = { due: Due; start: number; end: number };

/** The first date in `text`, read as the user would in `ctx.timeZone`. */
export function findDue(
  text: string,
  { now, timeZone }: CaptureContext,
): FoundDue | null {
  const offsetMinutes = fromDate(now, timeZone).offset / 60_000;
  const [hit] = chrono.parse(
    text,
    { instant: now, timezone: offsetMinutes },
    { forwardDate: true },
  );
  if (!hit) return null;
  const range = { start: hit.index, end: hit.index + hit.text.length };
  const s = hit.start;
  if (!s.isCertain("hour")) {
    const day = new CalendarDate(
      s.get("year") ?? 0,
      s.get("month") ?? 1,
      s.get("day") ?? 1,
    );
    return { due: { date: day.toString() }, ...range };
  }
  const moment = s.isCertain("timezoneOffset")
    ? fromDate(hit.date(), timeZone)
    : toZoned(
        new CalendarDateTime(
          s.get("year") ?? 0,
          s.get("month") ?? 1,
          s.get("day") ?? 1,
          s.get("hour") ?? 0,
          s.get("minute") ?? 0,
          s.get("second") ?? 0,
        ),
        timeZone,
      );
  return {
    due: {
      dateTime: moment.toString().replace(/\[.*\]$/, ""),
      timeZone,
    },
    ...range,
  };
}

/** The first date in `text` as a due, e.g. "friday 9am"; null when there is none. */
export function parseDue(text: string, ctx: CaptureContext): Due | null {
  return findDue(text, ctx)?.due ?? null;
}
