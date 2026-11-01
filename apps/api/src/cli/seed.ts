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
import { serverModules } from "../modules.gen";

/** Runs every module's `seed` in one transaction when `items` is empty. */
export async function seedIfEmpty(
  deps: CoreDeps,
  modules: readonly ServerModule[],
): Promise<boolean> {
  const [any] = await deps.db.select({ id: items.id }).from(items).limit(1);
  if (any) return false;
  await writeItems(deps, async (w) => {
    for (const m of modules) await m.seed?.(w);
  });
  return true;
}

async function main(): Promise<void> {
  const { db, close } = createDb(databaseUrlFrom(process.env));
  const { modules, itemTypes, aiRunners } = collectServerModules(
    [...serverModules],
    [...CORE_ROUTER_IDS],
    coreAi,
  );
  try {
    const seeded = await seedIfEmpty(
      {
        db,
        changes: createChangeBus(),
        itemTypes,
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
    console.log(seeded ? "Seeded sample data." : "Items exist — not seeding.");
  } finally {
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
