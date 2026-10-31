import { item, itemTitle, linkKind } from "../src/items";

test("linkKind rejects the reserved tagged kind", () => {
  expect(linkKind.safeParse("tagged").success).toBe(false);
  expect(linkKind.parse("mentions")).toBe("mentions");
});

test("itemTitle trims and rejects blank", () => {
  expect(itemTitle.parse("  Plan  ")).toBe("Plan");
  expect(itemTitle.safeParse("   ").success).toBe(false);
});

test("item requires archivedAt", () => {
  const base = {
    id: "0190a000-0000-7000-8000-000000000000",
    type: "note",
    title: "Plan",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  };
  expect(item.safeParse(base).success).toBe(false);
  expect(item.safeParse({ ...base, archivedAt: null }).success).toBe(true);
});
