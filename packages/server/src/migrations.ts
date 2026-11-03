import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ServerModule } from "./modules";

/**
 * The repo root, where `packages/db/drizzle` and `modules/<id>/drizzle` live
 * in a checkout. A bundled server (the Docker image) passes its own root.
 */
export function migrationsRoot(): string {
  return fileURLToPath(new URL("../../..", import.meta.url));
}

/** One migration folder and journal table per module that has migrations, in registry order. */
export function moduleMigrations(
  modules: readonly ServerModule[],
  root: string = migrationsRoot(),
): { id: string; folder: string; table: string }[] {
  return modules
    .filter((m) => m.migrations)
    .map((m) => ({
      id: m.id,
      folder: join(root, "modules", m.id, "drizzle"),
      table: `__drizzle_migrations_${m.id}`,
    }));
}
