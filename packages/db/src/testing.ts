import {
  createDb,
  type Db,
  DEFAULT_DATABASE_URL,
  DEFAULT_TEST_DATABASE_URL,
} from "./client";
import { resetDatabase } from "./reset";

function adminUrl(testUrl: string): string {
  const url = new URL(DEFAULT_DATABASE_URL);
  const parsed = new URL(testUrl);
  url.protocol = parsed.protocol;
  url.username = parsed.username;
  url.password = parsed.password;
  url.host = parsed.host;
  return url.toString();
}

/** Connects to the test database (creating it if missing), wipes it and migrates. */
export async function freshTestDb(): Promise<{
  db: Db;
  url: string;
  close: () => Promise<void>;
}> {
  const url = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const name = decodeURIComponent(new URL(url).pathname.slice(1));

  const admin = createDb(adminUrl(url));
  try {
    const exists = await admin.db
      .$client`select 1 from pg_database where datname = ${name}`;
    if (exists.length === 0) {
      await admin.db.$client.unsafe(
        `create database "${name.replaceAll('"', '""')}"`,
      );
    }
  } finally {
    await admin.close();
  }

  await resetDatabase(url);
  return { url, ...createDb(url) };
}
