import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const DEFAULT_MIGRATIONS_FOLDER = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);

export async function migrate(
  url: string,
  migrationsFolder: string = DEFAULT_MIGRATIONS_FOLDER,
): Promise<void> {
  const { db, close } = createDb(url);
  try {
    await drizzleMigrate(db, { migrationsFolder });
  } finally {
    await close();
  }
}
