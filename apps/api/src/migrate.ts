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
  await migrate(url, join(root, "packages", "db", "drizzle"));
  for (const m of moduleMigrations(modules, opts.modulesRoot ?? root)) {
    await migrate(url, m.folder, { table: m.table });
  }
}
