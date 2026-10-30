import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { createDb, DEFAULT_DATABASE_URL } from "./client";
import { migrate } from "./migrate";

/** Drops and recreates the `public` and `drizzle` schemas, then migrates. */
export async function resetDatabase(url: string): Promise<void> {
  const { db, close } = createDb(url);
  try {
    await db.execute(sql`drop schema if exists public cascade`);
    await db.execute(sql`drop schema if exists drizzle cascade`);
    await db.execute(sql`create schema public`);
  } finally {
    await close();
  }
  await migrate(url);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await resetDatabase(process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL);
}
