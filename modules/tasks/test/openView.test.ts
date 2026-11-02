import { expect, test } from "vitest";
import type { TaskRow } from "../src/schema";
import {
  groupOpenRows,
  nextUp,
  rowMeta,
  todayProgress,
} from "../src/screens/openView";

const today = "2026-11-04"; // a Wednesday

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

const on = (day: string, over: Partial<TaskRow> & { title: string }) =>
  row({ due: { date: day }, day, ...over });

test("groups in order; Overdue and Later only when non-empty", () => {
  const groups = groupOpenRows(
    [on("2026-11-04", { title: "a" }), row({ title: "b" })],
    today,
    { highOnly: false },
  );
  expect(
    groups.map((g) => [g.key, g.label, g.rows.map((r) => r.title)]),
  ).toEqual([
    ["today", "Today", ["a"]],
    ["week", "This week", []],
    ["none", "No date", ["b"]],
  ]);

  const all = groupOpenRows(
    [
      on("2026-11-20", { title: "later" }),
      on("2026-11-01", { title: "late" }),
      on("2026-11-06", { title: "fri" }),
    ],
    today,
    { highOnly: false },
  );
  expect(all.map((g) => g.key)).toEqual([
    "overdue",
    "today",
    "week",
    "later",
    "none",
  ]);
});

test("tasks done today stay in Today whatever their due", () => {
  const groups = groupOpenRows(
    [
      on("2026-11-01", {
        title: "was late",
        completedAt: "2026-11-04T08:00:00.000Z",
      }),
      row({ title: "undated", completedAt: "2026-11-04T09:00:00.000Z" }),
    ],
    today,
    { highOnly: false },
  );
  expect(
    groups.find((g) => g.key === "today")?.rows.map((r) => r.title),
  ).toEqual(["was late", "undated"]);
  expect(groups.some((g) => g.key === "overdue")).toBe(false);
});

test("High only keeps high-priority rows", () => {
  const groups = groupOpenRows(
    [
      on("2026-11-04", { title: "hi", priority: "high" }),
      on("2026-11-04", { title: "med" }),
    ],
    today,
    { highOnly: true },
  );
  expect(groups.flatMap((g) => g.rows.map((r) => r.title))).toEqual(["hi"]);
});

test("today's progress counts done and all of Today", () => {
  const rows = [
    on("2026-11-04", { title: "a", completedAt: "2026-11-04T08:00:00.000Z" }),
    on("2026-11-04", { title: "b" }),
    on("2026-11-05", { title: "c" }),
  ];
  expect(todayProgress(rows, today)).toEqual({ done: 1, total: 2 });
});

test("next up is the first open timed task still ahead today", () => {
  const tz = "America/Los_Angeles";
  const at = (iso: string, title: string, over: Partial<TaskRow> = {}) =>
    row({ title, due: { dateTime: iso }, day: today, ...over });
  const rows = [
    at("2026-11-04T16:00:00.000Z", "past"), // 8:00
    at("2026-11-04T18:00:00.000Z", "done", {
      completedAt: "2026-11-04T17:00:00.000Z",
    }),
    at("2026-11-04T19:30:00.000Z", "Review contracts"), // 11:30
    on("2026-11-04", { title: "any time" }),
  ];
  expect(nextUp(rows, new Date("2026-11-04T17:00:00.000Z"), tz)).toEqual({
    time: "11:30",
    title: "Review contracts",
  });
  expect(nextUp(rows, new Date("2026-11-04T20:00:00.000Z"), tz)).toBeNull();
});

test("row meta: when with origin zone, subtasks, parent and notes", () => {
  const tz = "Europe/London";
  const meta = rowMeta(
    row({
      title: "Call",
      due: {
        dateTime: "2026-11-04T17:00:00.000Z",
        timeZone: "America/Los_Angeles",
      },
      day: today,
      subtasks: { total: 4, done: 2, next: "Find the number" },
      parents: [
        { id: "p1", type: "task", title: "Bank stuff", archivedAt: null },
        { id: "p2", type: "task", title: "Admin", archivedAt: null },
      ],
      linkedNotes: 1,
    }),
    today,
    tz,
  );
  expect(meta).toEqual([
    "Today 17:00 · 9:00 PT",
    "2/4 · Next: Find the number",
    "in Bank stuff +1",
    "1 note",
  ]);
  expect(rowMeta(row({ title: "x", linkedNotes: 3 }), today, tz)).toEqual([
    "3 notes",
  ]);
});

test("a dated subtask names its parent", () => {
  const meta = rowMeta(
    on(today, {
      title: "x",
      parents: [{ id: "p", type: "task", title: "P", archivedAt: null }],
    }),
    today,
    "UTC",
  );
  expect(meta).toEqual(["Today", "in P"]);
});
