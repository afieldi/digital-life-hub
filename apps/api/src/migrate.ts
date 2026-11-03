import { join } from "node:path";
import { migrate } from "@dlh/db";
import {
  migrationsRoot,
  moduleMigrations,
  type ServerModule,
} from "@dlh/server";

/**
 * Core's migrations, then each module's in registry order, every module with
 * its own journal table. `root` holds `packages/db/drizzle` (default: the repo
 * root; a bundled server passes its own); `modulesRoot` holds each module's
 * `modules/<id>/drizzle` (default: `root`).
 */
export async function migrateAll(
  url: string,
  modules: readonly ServerModule[],
  opts: { root?: string; modulesRoot?: string } = {},
): Promise<void> {
  const root = opts.root ?? migrationsRoot();
  const core = join(root, "packages", "db", "drizzle");
  await step("Core", core, () => migrate(url, core));
  for (const m of moduleMigrations(modules, opts.modulesRoot ?? root)) {
    await step(`Module "${m.id}"`, m.folder, () =>
      migrate(url, m.folder, { table: m.table }),
    );
  }
}

/** Runs one migration set; a failure says whose folder it was, with the cause. */
async function step(
  whose: string,
  folder: string,
  run: () => Promise<void>,
): Promise<void> {
  try {
    await run();
  } catch (e) {
    throw new Error(`${whose} migrations failed (${folder})`, { cause: e });
  }
}
