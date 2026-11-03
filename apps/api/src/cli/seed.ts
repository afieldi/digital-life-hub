import { pathToFileURL } from "node:url";
import { createDb, databaseUrlFrom, items } from "@dlh/db";
import {
  type CoreDeps,
  createCoreDeps,
  type ServerModule,
  writeItems,
} from "@dlh/server";
import { inArray } from "drizzle-orm";
import { serverModules } from "../modules.gen";
import { composed } from "../router";

/**
 * Runs each module's `seed` that has never written: one with no row of its item
 * types in `items`, deleted rows included. So a module added to an existing dev
 * database still gets its sample data. Returns the ids of the seeded modules.
 */
export async function seedMissing(
  deps: CoreDeps,
  modules: readonly ServerModule[],
): Promise<string[]> {
  const seeded: string[] = [];
  for (const m of modules) {
    if (!m.seed || m.itemTypes.length === 0) continue;
    const [any] = await deps.db
      .select({ id: items.id })
      .from(items)
      .where(inArray(items.type, m.itemTypes))
      .limit(1);
    if (any) continue;
    const seed = m.seed;
    await writeItems(deps, (w) => seed(w));
    seeded.push(m.id);
  }
  return seeded;
}

async function main(): Promise<void> {
  const { db, close } = createDb(databaseUrlFrom(process.env));
  try {
    const seeded = await seedMissing(
      createCoreDeps(composed, { db }),
      serverModules,
    );
    console.log(
      seeded.length > 0
        ? `Seeded sample data for ${seeded.join(", ")}.`
        : "Every module already has items — not seeding.",
    );
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
