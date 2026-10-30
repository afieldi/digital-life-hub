import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export const DEFAULT_DATABASE_URL = "postgres://dlh:dlh@127.0.0.1:54329/dlh";
export const DEFAULT_TEST_DATABASE_URL =
  "postgres://dlh:dlh@127.0.0.1:54329/dlh_test";

/** `DATABASE_URL` from the environment; unset or empty means the Docker Postgres. */
export function databaseUrlFrom(
  env: Record<string, string | undefined>,
): string {
  return env.DATABASE_URL || DEFAULT_DATABASE_URL;
}

export type Db = ReturnType<typeof drizzle<typeof schema>>;

export function createDb(url: string): { db: Db; close: () => Promise<void> } {
  const client = postgres(url, { onnotice: () => {} });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}
