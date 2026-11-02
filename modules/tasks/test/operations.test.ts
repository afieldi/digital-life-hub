import type { PaletteContext } from "@dlh/core";
import { expect, test } from "vitest";
import { formatDue } from "../src/dates";
import { taskOps } from "../src/operations";

const ctx: PaletteContext = {
  text: "",
  now: new Date("2026-11-02T17:00:00Z"),
  timeZone: "America/Los_Angeles",
  item: {
    id: "8d3f1c0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f",
    type: "task",
    updatedAt: "2026-11-02T16:00:00.000Z",
  },
};

test("formatDue shows the day, and the wall time it was set at", () => {
  expect(formatDue({ date: "2026-11-06" })).toBe("Fri, Nov 6");
  expect(
    formatDue({
      dateTime: "2026-11-06T09:05:00-08:00",
      timeZone: "America/Los_Angeles",
    }),
  ).toBe("Fri, Nov 6 9:05");
});

test("create prefills from quick add and leaves missing parts unset", () => {
  const palette = taskOps.create.palette;
  if (typeof palette !== "object") throw new Error("expected a form");
  expect(palette.prefill?.({ ...ctx, text: "Call the bank fri p1" })).toEqual({
    title: "Call the bank",
    due: { date: "2026-11-06" },
    priority: "high",
  });
  expect(palette.prefill?.({ ...ctx, text: "" })).toEqual({
    title: undefined,
    due: undefined,
    priority: undefined,
  });
  expect(palette.params.safeParse({}).success).toBe(false);
});

test("reschedule reads a date and summarises it", () => {
  const palette = taskOps.reschedule.palette;
  if (typeof palette !== "object") throw new Error("expected a form");
  const params = palette.prefill?.({ ...ctx, text: "friday" });
  expect(params).toEqual({ due: { date: "2026-11-06" } });
  const input = palette.toInput(ctx, { due: { date: "2026-11-06" } });
  expect(input).toEqual({
    id: ctx.item?.id,
    expectedUpdatedAt: ctx.item?.updatedAt,
    due: { date: "2026-11-06" },
  });
  expect(taskOps.reschedule.summary(input)).toBe("Reschedule to Fri, Nov 6");
});

test("reorder's palette offers top and bottom only; rescheduleMany is hidden", () => {
  const palette = taskOps.reorder.palette;
  if (typeof palette !== "object") throw new Error("expected a form");
  expect(palette.params.shape.position.options).toEqual(["top", "bottom"]);
  expect(taskOps.rescheduleMany.palette).toBe(false);
  expect(taskOps.rescheduleMany.ai).toBe(false);
});

test("subjects: create and parent links act on the parent", () => {
  const parentId = "1d3f1c0e-1a2b-4c3d-8e9f-0a1b2c3d4e5f";
  expect(taskOps.create.subject({ title: "x" })).toBeNull();
  expect(taskOps.create.subject({ title: "x", parentId })).toBe(parentId);
  expect(taskOps.addParent.subject({ id: "a", parentId })).toBe(parentId);
  expect(taskOps.removeParent.subject({ id: "a", parentId })).toBe(parentId);
});

test("due reads friday, this week and next tue from ⌘K", () => {
  const palette = taskOps.due.palette;
  if (typeof palette !== "function") throw new Error("expected a function");
  const at = { ...ctx, item: undefined };
  expect(palette({ ...at, text: "friday" })).toEqual({
    from: "2026-11-06",
    to: "2026-11-07",
    timeZone: "America/Los_Angeles",
  });
  expect(palette({ ...at, text: "this week" })).toEqual({
    from: "2026-11-02",
    to: "2026-11-09",
    timeZone: "America/Los_Angeles",
  });
  expect(palette({ ...at, text: "next week" })).toMatchObject({
    from: "2026-11-09",
    to: "2026-11-16",
  });
  expect(palette({ ...at, text: "next tue" })).toMatchObject({
    from: "2026-11-10",
    to: "2026-11-11",
  });
  expect(palette({ ...at, text: "" })).toBeNull();
  expect(palette({ ...at, text: "bananas" })).toBeNull();
});

test("due headings name a day or a range", () => {
  const tz = "America/Los_Angeles";
  const heading = (from: string, to: string) =>
    taskOps.due.summary({ from, to, timeZone: tz });
  expect(heading("2026-11-06", "2026-11-07")).toBe("Due Fri, Nov 6");
  expect(heading("2026-11-02", "2026-11-09")).toBe("Due Nov 2 – 8");
  expect(heading("2026-10-30", "2026-11-06")).toBe("Due Oct 30 – Nov 5");
  expect(heading("2026-12-28", "2027-01-04")).toBe(
    "Due Dec 28, 2026 – Jan 3, 2027",
  );
});

test("reads: due is in ⌘K and AI; list, get and stats are screen-only", () => {
  expect(taskOps.due.kind).toBe("query");
  expect(taskOps.due.ai ?? true).toBe(true);
  for (const op of [taskOps.list, taskOps.get, taskOps.stats]) {
    expect(op.kind).toBe("query");
    expect(op.effects).toEqual([]);
    expect(op.palette).toBe(false);
    expect(op.ai).toBe(false);
  }
});
