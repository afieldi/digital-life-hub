import type { ItemSummary, ModuleRegistry } from "@dlh/core";
import {
  goToRows,
  itemRows,
  jumpGroup,
  matchesQuery,
} from "../src/shell/palette";

const itemTypes: ModuleRegistry["itemTypes"] = new Map([
  [
    "sample",
    {
      type: "sample",
      label: "Sample",
      glyph: "FlaskConical",
      color: "var(--color-type-ai)",
      href: (id: string) => `/sample/${id}`,
    },
  ],
]);

const summary = (id: string, type: string, title: string): ItemSummary => ({
  id,
  type,
  title,
  archivedAt: null,
});

test("matchesQuery is a case-insensitive substring over label and keywords", () => {
  expect(matchesQuery("Hello from Sample", ["greet"], "GREE")).toBe(true);
  expect(matchesQuery("Hello from Sample", undefined, "FROM")).toBe(true);
  expect(matchesQuery("Hello from Sample", ["greet"], "zzz")).toBe(false);
  expect(matchesQuery("Hello", undefined, "")).toBe(true);
  expect(matchesQuery("Hello", undefined, "   ")).toBe(true);
});

test("itemRows navigates to the type's href and disables unclaimed types", () => {
  const navigate = vi.fn();
  const rows = itemRows(
    [summary("a1", "sample", "Hello item"), summary("g1", "ghost", "Boo")],
    itemTypes,
    navigate,
  );
  expect(rows.map((r) => r.label)).toEqual(["Hello item", "Boo"]);
  expect(rows[0].disabled).toBeFalsy();
  expect(rows[0].icon).toBeTruthy();
  rows[0].onAction();
  expect(navigate).toHaveBeenCalledWith("/sample/a1");
  expect(rows[1].disabled).toBe(true);
  expect(rows[1].hint).toBe("no module for this type");
});

test("goToRows lists Home, keyed modules, then Settings", () => {
  const navigate = vi.fn();
  const rows = goToRows(
    [
      {
        label: "Sample",
        icon: "FlaskConical",
        path: "/sample",
        order: 1,
        key: "s",
      },
      { label: "Quiet", icon: "Puzzle", path: "/quiet", order: 2 },
    ],
    navigate,
  );
  expect(rows.map((r) => [r.label, r.hint])).toEqual([
    ["Home", "G H"],
    ["Sample", "G S"],
    ["Quiet", undefined],
    ["Settings", undefined],
  ]);
  rows[1].onAction();
  expect(navigate).toHaveBeenCalledWith("/sample");
});

test("jumpGroup reflects the search state", () => {
  const items = [{ id: "x", label: "X", onAction: () => {} }];
  expect(jumpGroup({ status: "idle", items: [] })).toBeNull();
  expect(jumpGroup({ status: "loading", items: [] })).toMatchObject({
    id: "jump",
    label: "Jump to",
    items: [],
  });
  expect(jumpGroup({ status: "error", items: [] })?.message).toBe(
    "Search unavailable",
  );
  expect(jumpGroup({ status: "ok", items: [] })?.message).toBe(
    "No items match",
  );
  expect(jumpGroup({ status: "ok", items })).toMatchObject({ items });
  expect(jumpGroup({ status: "ok", items })?.message).toBeUndefined();
});
