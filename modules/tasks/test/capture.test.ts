import { expect, test } from "vitest";
import { parseDue, parseTaskInput } from "../src/capture";

const LA = "America/Los_Angeles";
// Monday 2 Nov 2026, 10:00 in Los Angeles.
const ctx = { now: new Date("2026-11-02T10:00:00-08:00"), timeZone: LA };

test("a date, a time and a priority", () => {
  const r = parseTaskInput("Call the bank fri 9am p1", ctx);
  expect(r.title).toBe("Call the bank");
  expect(r.due).toEqual({
    dateTime: "2026-11-06T09:00:00-08:00",
    timeZone: LA,
  });
  expect(r.priority).toBe("high");
});

test("a day alone is a date", () => {
  const r = parseTaskInput("Water plants tomorrow p2", ctx);
  expect(r.title).toBe("Water plants");
  expect(r.due).toEqual({ date: "2026-11-03" });
  expect(r.priority).toBe("medium");
});

test("a lone ! is High; a trailing ! on a word is not", () => {
  const a = parseTaskInput("Call the bank ! ", ctx);
  expect(a.priority).toBe("high");
  expect(a.title).toBe("Call the bank");
  const b = parseTaskInput("Call Mum!", ctx);
  expect(b.title).toBe("Call Mum!");
  expect(b.priority).toBeNull();
});

test("p0 and p3 are not parsed; priority is a whole word, any case", () => {
  expect(parseTaskInput("Thing p3", ctx)).toMatchObject({
    title: "Thing p3",
    priority: null,
  });
  expect(parseTaskInput("Thing p0", ctx).priority).toBeNull();
  expect(parseTaskInput("Thing P1", ctx).priority).toBe("high");
  expect(parseTaskInput("Thing p12", ctx).priority).toBeNull();
});

test("#word stays in the title", () => {
  const r = parseTaskInput("Plan #q4", ctx);
  expect(r.title).toBe("Plan #q4");
  expect(r.due).toBeNull();
});

test("a date only leaves an empty title", () => {
  const r = parseTaskInput("tomorrow 9am", ctx);
  expect(r.title).toBe("");
  expect(r.due).toEqual({
    dateTime: "2026-11-03T09:00:00-08:00",
    timeZone: LA,
  });
});

test("spans cover the text that was read", () => {
  const text = "Call the bank fri 9am p1";
  const r = parseTaskInput(text, ctx);
  const covered = r.spans.map((s) => ({
    kind: s.kind,
    text: text.slice(s.start, s.end),
  }));
  expect(covered).toEqual([
    { kind: "due", text: "fri 9am" },
    { kind: "priority", text: "p1" },
  ]);
});

test("forwardDate: a weekday is never in the past", () => {
  // Monday: "mon" means next Monday only if already past; "fri" is this week.
  expect(parseDue("fri", ctx)).toEqual({ date: "2026-11-06" });
  expect(parseDue("next tue", ctx)).toEqual({ date: "2026-11-10" });
  expect(parseDue("Nov 6", ctx)).toEqual({ date: "2026-11-06" });
});

test("a month-day already past rolls to next year", () => {
  expect(parseDue("Jan 5", ctx)).toEqual({ date: "2027-01-05" });
});

test("the offset follows the zone at that moment (DST)", () => {
  const r = parseDue("tomorrow 10am", {
    now: new Date("2027-03-13T12:00:00-08:00"),
    timeZone: LA,
  });
  expect(r).toEqual({
    dateTime: "2027-03-14T10:00:00-07:00",
    timeZone: LA,
  });
});

test("the day is read in the given zone, not the machine's", () => {
  // 23:30 in LA on Nov 2 is already Nov 3 in UTC.
  const r = parseDue("today", {
    now: new Date("2026-11-03T07:30:00Z"),
    timeZone: LA,
  });
  expect(r).toEqual({ date: "2026-11-02" });
});

test("no date means null", () => {
  expect(parseDue("Buy milk", ctx)).toBeNull();
  expect(parseTaskInput("Buy milk", ctx)).toEqual({
    title: "Buy milk",
    due: null,
    priority: null,
    spans: [],
  });
});
