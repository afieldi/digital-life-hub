import { indexFor } from "../src/patterns/boardMath";

const col = ["a", "b", "c"];
const on = (key: string, dropPosition: "before" | "after") =>
  ({ type: "item", key, dropPosition }) as const;

test("cross-column insert: before/after an item, and root", () => {
  // Moving card "x" comes from another column, so it isn't in `ids`.
  expect(indexFor(col, ["x"], on("a", "before"))).toBe(0);
  expect(indexFor(col, ["x"], on("a", "after"))).toBe(1);
  expect(indexFor(col, ["x"], on("c", "after"))).toBe(3);
  expect(indexFor(col, ["x"], { type: "root" })).toBe(3);
  expect(indexFor([], ["x"], { type: "root" })).toBe(0);
});

test("same-column reorder counts positions without the moving card", () => {
  // a b c: move a after c → b c a
  expect(indexFor(col, ["a"], on("c", "after"))).toBe(2);
  // move c before a → c a b
  expect(indexFor(col, ["c"], on("a", "before"))).toBe(0);
  // move a after b → b a c
  expect(indexFor(col, ["a"], on("b", "after"))).toBe(1);
  // move c before b → a c b
  expect(indexFor(col, ["c"], on("b", "before"))).toBe(1);
  // root drop on its own column → end
  expect(indexFor(col, ["a"], { type: "root" })).toBe(2);
});

test("multi-card moves and unknown targets", () => {
  expect(indexFor(col, ["a", "b"], on("c", "after"))).toBe(1);
  // target is itself one of the moving cards → falls back to the end
  expect(indexFor(col, ["b"], on("b", "before"))).toBe(2);
});
