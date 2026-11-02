import type { Due } from "@dlh/core";
import {
  CalendarDate,
  CalendarDateTime,
  fromDate,
  toZoned,
} from "@internationalized/date";
import * as chrono from "chrono-node";
import type { Priority } from "./schema";

export type CaptureContext = { now: Date; timeZone: string };

export type CaptureSpan = {
  start: number;
  end: number;
  kind: "due" | "priority";
};

export type ParsedTaskInput = {
  title: string;
  due: Due | null;
  priority: Priority | null;
  spans: CaptureSpan[];
};

/** `p1`, `p2` or a lone `!`, each a whole word. `p0` and `p3` are reserved for later levels. */
const PRIORITY_WORD = /(?<=^|\s)(p1|p2|!)(?=\s|$)/gi;

function priorityOf(word: string): Priority {
  return word === "!" || word.toLowerCase() === "p1" ? "high" : "medium";
}

type Found = { due: Due; start: number; end: number };

/** The first date in `text`, read as the user would in `ctx.timeZone`. */
function findDue(
  text: string,
  { now, timeZone }: CaptureContext,
): Found | null {
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

/** The date half of quick add: used by `reschedule` and `due`. */
export function parseDue(text: string, ctx: CaptureContext): Due | null {
  return findDue(text, ctx)?.due ?? null;
}

/**
 * Splits a quick-add line into title, due and priority, and the spans it read.
 * Pure: runs on every keystroke, offline.
 */
export function parseTaskInput(
  text: string,
  ctx: CaptureContext,
): ParsedTaskInput {
  const spans: CaptureSpan[] = [];
  let priority: Priority | null = null;
  // Priority words are blanked (same length, so indices hold) before reading the date.
  const masked = text.replace(PRIORITY_WORD, (word, _w, offset: number) => {
    priority = priorityOf(word);
    spans.push({ start: offset, end: offset + word.length, kind: "priority" });
    return " ".repeat(word.length);
  });
  const found = findDue(masked, ctx);
  if (found) spans.push({ start: found.start, end: found.end, kind: "due" });
  spans.sort((a, b) => a.start - b.start);

  let title = "";
  let at = 0;
  for (const span of spans) {
    if (span.start >= at) title += text.slice(at, span.start);
    at = Math.max(at, span.end);
  }
  title += text.slice(at);
  return {
    title: title.replace(/\s+/g, " ").trim(),
    due: found?.due ?? null,
    priority,
    spans,
  };
}
