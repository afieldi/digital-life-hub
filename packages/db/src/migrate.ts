import { fileURLToPath, pathToFileURL } from "node:url";
import { migrate as drizzleMigrate } from "drizzle-orm/postgres-js/migrator";
import { createDb, DEFAULT_DATABASE_URL } from "./client";

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

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await migrate(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
}
