import { createTestApi, serverModules } from "@dlh/api/testing";
import { registry } from "../src/modules";

// Each module registers twice: its manifest here, its server module in the
// API. These compare the real registries, so the two sides can't drift.

const serverOps = serverModules.flatMap((m) =>
  Object.values(m.operations ?? {}).map((op) => op.desc.id),
);

test("every server module has a manifest; client-only ones own no data", () => {
  const serverIds = new Set<string>(serverModules.map((m) => m.id));
  const clientIds = registry.modules.map((m) => m.id);
  for (const id of serverIds) expect(clientIds).toContain(id);
  // A module with no server half (Home) can't own item types or operations.
  for (const m of registry.modules.filter((m) => !serverIds.has(m.id))) {
    expect(m.itemType, m.id).toBeUndefined();
    expect(m.operations ?? [], m.id).toEqual([]);
    expect(m.aiActions ?? [], m.id).toEqual([]);
  }
});

test.each(serverModules.map((m) => [m.id, m] as const))(
  "%s: every server item type has a client item type",
  (_id, m) => {
    for (const type of m.itemTypes) {
      expect(registry.itemTypes.has(type), type).toBe(true);
    }
  },
);

test("⌘K offers exactly the operations the server implements", () => {
  expect(registry.operations.map((op) => op.id).sort()).toEqual(
    [...serverOps].sort(),
  );
});

test("every client AI action has a server runner", () => {
  const runners = createTestApi().deps.ai.runners;
  for (const action of registry.aiActions) {
    expect(runners.has(action.id), action.id).toBe(true);
  }
});
