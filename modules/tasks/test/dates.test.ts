import { expect, test } from "vitest";
import {
  addDays,
  dayOfDue,
  formatWhen,
  groupFor,
  instantBounds,
  moveToDay,
  todayIn,
  weekStartOf,
} from "../src/dates";

const LA = "America/Los_Angeles";
const hours = (b: { from: Date; to: Date }) =>
  (b.to.getTime() - b.from.getTime()) / 3_600_000;

test("dayOfDue puts a timed task on the day in the given zone", () => {
  const due = { dateTime: "2026-11-06T23:30:00-05:00" };
  expect(dayOfDue(due, "Europe/London")).toBe("2026-11-07");
  expect(dayOfDue(due, "America/New_York")).toBe("2026-11-06");
});

test("dayOfDue keeps a day-only task on its day in any zone", () => {
  for (const tz of ["Pacific/Auckland", LA, "UTC"]) {
    expect(dayOfDue({ date: "2026-11-06" }, tz)).toBe("2026-11-06");
  }
  expect(dayOfDue(null, LA)).toBeNull();
});

test("week bounds across DST", () => {
  expect(hours(instantBounds("2026-10-26", "2026-11-02", LA))).toBe(169);
  expect(hours(instantBounds("2027-03-08", "2027-03-15", LA))).toBe(167);
  expect(instantBounds("2026-11-02", "2026-11-03", LA).from.toISOString()).toBe(
    "2026-11-02T08:00:00.000Z",
  );
});

test("todayIn uses the zone", () => {
  const now = new Date("2026-11-03T03:00:00Z");
  expect(todayIn(now, LA)).toBe("2026-11-02");
  expect(todayIn(now, "Europe/London")).toBe("2026-11-03");
});

test("weekStartOf is Monday", () => {
  expect(weekStartOf("2026-11-08")).toBe("2026-11-02");
  expect(weekStartOf("2026-11-02")).toBe("2026-11-02");
  expect(weekStartOf("2026-11-04")).toBe("2026-11-02");
});

test("addDays", () => {
  expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
  expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
});

test("groupFor at the boundaries", () => {
  const today = "2026-11-04"; // Wednesday; week is Mon Nov 2 - Sun Nov 8
  expect(groupFor(null, today)).toBe("none");
  expect(groupFor("2026-11-03", today)).toBe("overdue");
  expect(groupFor("2026-11-04", today)).toBe("today");
  expect(groupFor("2026-11-05", today)).toBe("week");
  expect(groupFor("2026-11-08", today)).toBe("week");
  expect(groupFor("2026-11-09", today)).toBe("later");
});

test("moveToDay keeps a day-only task floating", () => {
  expect(moveToDay({ date: "2026-11-02" }, "2026-11-05", LA)).toEqual({
    date: "2026-11-05",
  });
});

test("moveToDay keeps the wall-clock time and re-reads the offset", () => {
  const due = {
    dateTime: "2026-11-02T09:00:00-08:00",
    timeZone: LA,
  };
  expect(moveToDay(due, "2026-11-06", LA)).toEqual({
    dateTime: "2026-11-06T09:00:00-08:00",
    timeZone: LA,
  });
  // Crosses the spring DST change: 9:00 stays 9:00 local.
  expect(
    moveToDay(
      { dateTime: "2027-03-08T09:00:00-08:00", timeZone: LA },
      "2027-03-15",
      LA,
    ),
  ).toEqual({ dateTime: "2027-03-15T09:00:00-07:00", timeZone: LA });
});

test("moveToDay keeps the local time", () => {
  const due = { dateTime: "2026-11-02T09:00:00-08:00", timeZone: LA };
  const moved = moveToDay(due, "2026-11-05", LA);
  expect(moved).toEqual({
    dateTime: "2026-11-05T09:00:00-08:00",
    timeZone: LA,
  });
  expect(dayOfDue(moved, LA)).toBe("2026-11-05");
  expect(formatWhen(moved, LA, "2026-11-05").text).toBe("Today 9:00");
});

test("moveToDay keeps the time it shows in the viewing zone, and the zone it was set in", () => {
  // 9:00 in Tokyo on Nov 5 is 16:00 on Nov 4 in Los Angeles.
  const due = { dateTime: "2026-11-05T09:00:00+09:00", timeZone: "Asia/Tokyo" };
  expect(dayOfDue(due, LA)).toBe("2026-11-04");
  const moved = moveToDay(due, "2026-11-06", LA);
  expect(moved).toEqual({
    dateTime: "2026-11-06T16:00:00-08:00",
    timeZone: "Asia/Tokyo",
  });
  expect(dayOfDue(moved, LA)).toBe("2026-11-06");
  expect(formatWhen(moved, LA, "2026-11-06")).toEqual({
    text: "Today 16:00",
    origin: "9:00 GMT+9",
  });
});

test("moveToDay without a stored zone uses the given zone", () => {
  expect(
    moveToDay({ dateTime: "2026-11-02T09:00:00-08:00" }, "2026-11-03", LA),
  ).toEqual({ dateTime: "2026-11-03T09:00:00-08:00" });
});

test("formatWhen", () => {
  const today = "2026-11-02";
  expect(formatWhen({ date: "2026-11-02" }, LA, today)).toEqual({
    text: "Today",
  });
  expect(formatWhen({ date: "2026-11-03" }, LA, today)).toEqual({
    text: "Tomorrow",
  });
  expect(formatWhen({ date: "2026-11-06" }, LA, today).text).toBe("Fri");
  expect(formatWhen({ date: "2026-12-25" }, LA, today).text).toBe("Dec 25");
  expect(formatWhen({ date: "2025-12-25" }, LA, today).text).toBe(
    "Dec 25, 2025",
  );
});

test("formatWhen uses 24-hour times", () => {
  const due = { dateTime: "2026-11-02T14:00:00-08:00", timeZone: LA };
  expect(formatWhen(due, LA, "2026-11-02")).toEqual({ text: "Today 14:00" });
  expect(formatWhen(due, "America/New_York", "2026-11-02").origin).toBe(
    "14:00 PT",
  );
});

test("formatWhen shows the time and the origin zone when it differs", () => {
  const today = "2026-11-02";
  const due = { dateTime: "2026-11-02T09:00:00-08:00", timeZone: LA };
  expect(formatWhen(due, LA, today)).toEqual({ text: "Today 9:00" });
  expect(formatWhen(due, "America/New_York", today)).toEqual({
    text: "Today 12:00",
    origin: "9:00 PT",
  });
});
