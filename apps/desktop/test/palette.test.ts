import {
  type ItemSummary,
  type ModuleRegistry,
  NotReady,
  type OperationDescription,
} from "@dlh/core";
import { requestOps } from "../../../modules/requests/src/operations";
import {
  operationRows,
  operationText,
  planOperation,
} from "../src/operations/rows";
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

const { resolve } = requestOps;
const onRequest = {
  item: { id: "r1", type: "request", updatedAt: "2026-11-02T09:00:00.000Z" },
  now: new Date(),
  timeZone: "UTC",
};

test("operationText names the label or word it matched, lowercased", () => {
  expect(operationText(resolve, "NOT FOR ME please")).toEqual({
    text: "please",
    by: "word",
    name: "not for me",
  });
  expect(operationText(resolve, "Resolve request as handled")).toEqual({
    text: "as handled",
    by: "label",
    name: "resolve request",
  });
  // The start of the label names the label.
  expect(operationText(resolve, "reso")).toEqual({
    text: "",
    by: "label",
    name: "resolve request",
  });
  expect(operationText(resolve, "unrelated")).toBeNull();
});

test("a form sees the word ⌘K matched, which the text no longer holds", () => {
  const onChoose = vi.fn();
  const rows = operationRows([resolve], onRequest, "not for me", onChoose);
  const row = rows.actions[0];
  expect(row?.label).toBe("Not for me");
  row?.onAction();
  const ctx = onChoose.mock.calls[0]?.[1];
  expect(ctx).toMatchObject({ text: "", name: "not for me" });
  expect(planOperation(resolve, ctx)).toMatchObject({
    status: "ready",
    input: { id: "r1", outcome: "not_for_me" },
  });
});

describe("a palette builder that throws", () => {
  // Reopen's input built by a palette function that throws.
  const withPalette = (palette: () => never): OperationDescription => ({
    ...requestOps.reopen,
    palette,
  });
  const ctx = { text: "", now: new Date(), timeZone: "UTC" };

  test("NotReady waits quietly", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const op = withPalette(() => {
      throw new NotReady("No item on screen");
    });
    expect(planOperation(op, ctx).status).toBe("waiting");
    expect(log).not.toHaveBeenCalled();
    log.mockRestore();
  });

  test("any other error also waits, and is logged as a bug", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const op = withPalette(() => {
      throw new TypeError("boom");
    });
    expect(planOperation(op, ctx).status).toBe("waiting");
    expect(log).toHaveBeenCalledWith(
      "⌘K: building an operation failed",
      expect.objectContaining({ message: "boom" }),
    );
    log.mockRestore();
  });
});
