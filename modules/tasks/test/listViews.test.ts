import { expect, test } from "vitest";
import type { TaskRow } from "../src/schema";
import { editedLine, linkedRows } from "../src/screens/detailView";
import { dayBars, doneTime, groupDone } from "../src/screens/doneView";
import {
  cardWhen,
  dropPosition,
  splitUpcoming,
  weekColumns,
  weekLabel,
} from "../src/screens/upcomingView";

const LA = "America/Los_Angeles";

let n = 0;
function row(over: Partial<TaskRow> & { title: string }): TaskRow {
  n++;
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
    updatedAt: "2026-11-01T00:00:00.000Z",
    completedAt: null,
    due: null,
    priority: "medium",
    notes: null,
    day: null,
    subtasks: { total: 0, done: 0, next: null },
    parents: [],
    linkedNotes: 0,
    sortKey: "a0",
    ...over,
  };
}

test("a week is seven columns from Monday", () => {
  const cols = weekColumns("2026-11-02");
  expect(cols.map((c) => c.id)).toEqual([
    "2026-11-02",
    "2026-11-03",
    "2026-11-04",
    "2026-11-05",
    "2026-11-06",
    "2026-11-07",
    "2026-11-08",
  ]);
  expect(cols.map((c) => c.title)).toEqual([
    "Mon 2",
    "Tue 3",
    "Wed 4",
    "Thu 5",
    "Fri 6",
    "Sat 7",
    "Sun 8",
  ]);
});

test("week label", () => {
  expect(weekLabel("2026-11-02")).toBe("Nov 2 – 8");
  expect(weekLabel("2026-11-30")).toBe("Nov 30 – Dec 6");
  expect(weekLabel("2026-12-28")).toBe("Dec 28, 2026 – Jan 3, 2027");
});

test("upcoming splits the week from later", () => {
  const rows = [
    row({ title: "mon", day: "2026-11-02" }),
    row({ title: "sun", day: "2026-11-08" }),
    row({ title: "next", day: "2026-11-09" }),
  ];
  const { week, later } = splitUpcoming(rows, "2026-11-02");
  expect(week.map((r) => r.title)).toEqual(["mon", "sun"]);
  expect(later.map((r) => r.title)).toEqual(["next"]);
});

test("a card shows its time, or Any time", () => {
  expect(
    cardWhen(
      row({ title: "t", due: { dateTime: "2026-11-04T17:00:00.000Z" } }),
      LA,
    ),
  ).toBe("9:00");
  expect(cardWhen(row({ title: "d", due: { date: "2026-11-04" } }), LA)).toBe(
    "Any time",
  );
});

test("a drop index becomes a reorder position", () => {
  expect(dropPosition(["a", "b"], 0)).toBe("top");
  expect(dropPosition(["a", "b"], 1)).toEqual({ after: "a" });
  expect(dropPosition(["a", "b"], 5)).toEqual({ after: "b" });
  expect(dropPosition([], 0)).toBe("top");
});

test("done groups by the day it was completed, in the device's zone", () => {
  const today = "2026-11-04";
  const groups = groupDone(
    [
      // 15:20 LA on the 4th
      row({ title: "a", completedAt: "2026-11-04T23:20:00.000Z" }),
      // 23:30 LA on the 3rd, already the 4th in UTC
      row({ title: "b", completedAt: "2026-11-04T07:30:00.000Z" }),
      row({ title: "c", completedAt: "2026-10-29T17:00:00.000Z" }),
    ],
    today,
    LA,
  );
  expect(groups.map((g) => [g.label, g.rows.map((r) => r.title)])).toEqual([
    ["Today", ["a"]],
    ["Yesterday", ["b"]],
    ["Thu, Oct 29", ["c"]],
  ]);
  expect(
    doneTime(row({ title: "a", completedAt: "2026-11-04T23:20:00.000Z" }), LA),
  ).toBe("15:20");
});

test("day bars name each weekday", () => {
  const bars = dayBars([
    { day: "2026-11-02", count: 1 },
    { day: "2026-11-03", count: 0 },
  ]);
  expect(bars).toEqual([
    { label: "Mon", value: 1 },
    { label: "Tue", value: 0 },
  ]);
});

test("edited line", () => {
  expect(
    editedLine(
      "2026-10-28T17:00:00.000Z",
      "2026-11-04T22:05:00.000Z",
      LA,
      "2026-11-04",
    ),
  ).toBe("Created Oct 28 · edited Today 14:05");
});

test("Linked leaves out parents and subtasks", () => {
  const self = "00000000-0000-4000-8000-000000000000";
  const item = (id: string, type: string, title: string) => ({
    id,
    type,
    title,
    archivedAt: null,
  });
  const link = (
    fromId: string,
    toId: string,
    kind: "contains" | "relates" | "mentions",
    other: ReturnType<typeof item>,
  ) => ({
    id: `${fromId}-${toId}`,
    fromId,
    toId,
    kind,
    context: null,
    createdAt: "2026-11-01T00:00:00.000Z",
    item: other,
  });
  const sub = item("s", "task", "Sub");
  const parent = item("p", "task", "Parent");
  const ref = item("r", "task", "Related");
  const note = item("n", "note", "Notes");
  const rows = linkedRows({
    outgoing: [
      link(self, "s", "contains", sub),
      link(self, "r", "relates", ref),
    ],
    backlinks: [
      link("p", self, "contains", parent),
      link("n", self, "mentions", note),
    ],
  });
  expect(rows.map((r) => [r.item.title, r.direction])).toEqual([
    ["Related", "outgoing"],
    ["Notes", "backlink"],
  ]);
});
