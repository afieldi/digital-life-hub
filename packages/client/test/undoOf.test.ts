import { expect, test } from "vitest";
import { undoOf } from "../src/index";

test("undoOf finds the undo token only when the write changed something", () => {
  const created = {
    record: null,
    created: ["0b7e3f0e-7a55-4a3b-9c0e-2f7d4f6f1a11"],
  };
  expect(undoOf({ result: 1, undo: created })).toEqual(created);
  const record = { record: { id: "x" }, created: [] };
  expect(undoOf({ result: 1, undo: record })).toEqual(record);
  // A no-op write, an action without an undo token, or no result at all.
  expect(undoOf({ result: 1, undo: { record: null, created: [] } })).toBeNull();
  expect(undoOf({ result: 1 })).toBeNull();
  expect(undoOf({ result: 1, undo: null })).toBeNull();
  expect(undoOf({ result: 1, undo: { record: 1 } })).toBeNull();
  expect(undoOf(null)).toBeNull();
  expect(undoOf(undefined)).toBeNull();
});

test("undoOf keeps the undo records of the operations a write called", () => {
  const calls = [{ operation: "tasks.setAssignee", record: { id: "t" } }];
  const token = { record: { id: "x" }, created: [], calls };
  expect(undoOf({ result: 1, undo: token })).toEqual(token);
  // Only a called operation changed something: Undo is still offered.
  const onlyCalls = { record: null, created: [], calls };
  expect(undoOf({ result: 1, undo: onlyCalls })).toEqual(onlyCalls);
  expect(
    undoOf({ result: 1, undo: { record: null, created: [], calls: [] } }),
  ).toBeNull();
  expect(
    undoOf({ result: 1, undo: { record: 1, created: [], calls: [{}] } }),
  ).toBeNull();
});
