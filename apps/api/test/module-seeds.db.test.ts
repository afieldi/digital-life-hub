import { items } from "@dlh/db";
import { writeItems } from "@dlh/server";
import { createTestApi, freshModuleDb, serverModules } from "../src/testing";

// A module's seed fills a dev database with its own sample items. Writing
// another module's type would make that module think it was seeded already.
const seeded = serverModules.filter((m) => m.seed);

test("there are seeds to check", () =>
  expect(seeded.length).toBeGreaterThan(0));

test.each(seeded.map((m) => [m.id, m] as const))(
  "%s's seed writes items of its own types only",
  async (_id, m) => {
    const t = await freshModuleDb(serverModules);
    try {
      const api = createTestApi({ db: t.db });
      const seed = m.seed;
      if (!seed) return;
      await writeItems(api.deps, (w) => seed(w));
      const types = new Set(
        (await t.db.select({ type: items.type }).from(items)).map(
          (r) => r.type,
        ),
      );
      expect(types.size).toBeGreaterThan(0);
      for (const type of types) expect(m.itemTypes).toContain(type);
    } finally {
      await t.close();
    }
  },
);
