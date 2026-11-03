import { pathToFileURL } from "node:url";
import { createDb, databaseUrlFrom, items } from "@dlh/db";
import {
  CORE_ROUTER_IDS,
  type CoreDeps,
  collectServerModules,
  coreAi,
  createChangeBus,
  type ServerModule,
  writeItems,
} from "@dlh/server";
import { inArray } from "drizzle-orm";
import { serverModules } from "../modules.gen";

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
  const { modules, itemTypes, aiRunners, deleteWith, operations } =
    collectServerModules([...serverModules], [...CORE_ROUTER_IDS], coreAi);
  try {
    const seeded = await seedMissing(
      {
        db,
        changes: createChangeBus(),
        itemTypes,
        deleteWith,
        operations,
        now: () => new Date(),
        devErrors: false,
        ai: {
          runners: aiRunners,
          providers: {},
          defaultModel: null,
        },
      },
      modules,
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
