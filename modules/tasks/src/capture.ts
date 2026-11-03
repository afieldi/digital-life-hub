import type { Due } from "@dlh/core";
import { type CaptureContext, findDue } from "@dlh/core/capture";
import type { Priority } from "./schema";

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
