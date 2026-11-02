import { fileURLToPath } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

// Resolved lazily: importing @dlh/db must work where import.meta.url is not a file URL (jsdom tests).
const defaultMigrationsFolder = () =>
  fileURLToPath(new URL("../drizzle", import.meta.url));

export async function migrate(
  url: string,
  migrationsFolder: string = defaultMigrationsFolder(),
  /** `table` names the journal table (in schema `drizzle`); modules each keep their own. */
  opts: { table?: string } = {},
): Promise<void> {
  const { db, close } = createDb(url);
  try {
    await drizzleMigrate(db, {
      migrationsFolder,
      ...(opts.table
        ? { migrationsTable: opts.table, migrationsSchema: "drizzle" }
        : {}),
    });
  } finally {
    await close();
  }
}
