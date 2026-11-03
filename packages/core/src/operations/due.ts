import { z } from "zod";
import { timeZoneValue } from "../time";

/**
 * When a thing is due, in Google Calendar's shape: a whole day with no time
 * (floating, the same day in every zone), or a moment with the IANA zone it
 * was set in.
 */
export const dueValue = z.union([
  z.object({ date: z.iso.date() }).strict(),
  z
    .object({
      dateTime: z.iso.datetime({ offset: true }),
      timeZone: timeZoneValue.optional(),
    })
    .strict(),
]);
export type Due = z.infer<typeof dueValue>;

/**
 * A due as the model gives it: a whole day, or a day and time in the person's
 * local time with no offset. Models get UTC offsets wrong (DST above all), so
 * Core sets the time in the request's zone (`dueFromLocal`).
 */
export const localDueValue = z
  .union([
    z.object({ date: z.iso.date() }).strict(),
    z
      .object({
        dateTime: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
          .describe("YYYY-MM-DDTHH:MM, with no offset"),
      })
      .strict(),
  ])
  .describe(
    "A whole day as { date }, or a day and time as { dateTime }, in the person's local time (the zone on the Today line). Never add a UTC offset.",
  );
export type LocalDue = z.infer<typeof localDueValue>;

/** Minutes `timeZone` is ahead of UTC at the instant `ms`. */
function offsetMinutes(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(new Date(ms));
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return Math.round((wall - Math.floor(ms / 1000) * 1000) / 60_000);
}

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * A model's local due as stored: a day as is, a wall time as the instant it
 * is in `timeZone` (with that offset) and the zone. A time skipped by a DST
 * change lands just after it.
 */
export function dueFromLocal(local: LocalDue, timeZone: string): Due {
  if ("date" in local) return { date: local.date };
  const [y = 0, mo = 1, d = 1, h = 0, mi = 0] = local.dateTime
    .split(/[-T:]/)
    .map(Number);
  const wall = Date.UTC(y, mo - 1, d, h, mi);
  // The zone's offsets either side of a DST change that day: the instant is
  // the first that shows this wall time. In a skipped hour, the offset from
  // before the change puts it just after.
  const day = 12 * 3_600_000;
  const before = wall - offsetMinutes(wall - day, timeZone) * 60_000;
  const after = wall - offsetMinutes(wall + day, timeZone) * 60_000;
  const shows = (ms: number) =>
    ms + offsetMinutes(ms, timeZone) * 60_000 === wall;
  const ms = shows(before) || !shows(after) ? before : after;
  const offset = offsetMinutes(ms, timeZone);
  const shown = new Date(ms + offset * 60_000).toISOString().slice(0, 19);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return {
    dateTime: `${shown}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`,
    timeZone,
  };
}
