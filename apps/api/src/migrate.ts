import { join } from "node:path";
import { migrate } from "@dlh/db";
import {
  migrationsRoot,
  moduleMigrations,
  type ServerModule,
} from "@dlh/server";

/**
 * Core's migrations, then each module's in registry order, every module with
 * its own journal table. `root` holds each module's `modules/<id>/drizzle`
 * (default `MIGRATIONS_ROOT`, else the repo root); Core's folder always comes
 * from `MIGRATIONS_ROOT` or the repo root.
 */
export async function migrateAll(
  url: string,
  modules: readonly ServerModule[],
  root: string = migrationsRoot(),
): Promise<void> {
  await migrate(url, join(migrationsRoot(), "packages", "db", "drizzle"));
  for (const m of moduleMigrations(modules, root)) {
    await migrate(url, m.folder, { table: m.table });
  }
}
