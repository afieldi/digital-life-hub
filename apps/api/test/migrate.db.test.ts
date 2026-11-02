import { fileURLToPath } from "node:url";
import { createDb } from "@dlh/db";
import { freshTestDb } from "@dlh/db/testing";
import type { ServerModule } from "@dlh/server";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { migrateAll } from "../src/migrate";

const root = fileURLToPath(new URL("./fixtures/migrations", import.meta.url));
const demo = {
  id: "demo",
  itemTypes: [],
  router: {} as never,
  migrations: true,
} satisfies ServerModule;

let url: string;

const count = async (table: string) => {
  const { db, close } = createDb(url);
  try {
    const rows = await db.execute(
      sql.raw(`select count(*)::int as n from drizzle."${table}"`),
    );
    return (rows[0] as { n: number }).n;
  } finally {
    await close();
  }
};

beforeAll(async () => {
  // An empty database: migrateAll applies Core itself.
  const fresh = await freshTestDb();
  url = fresh.url;
  await fresh.db.execute(sql`drop schema public cascade`);
  await fresh.db.execute(sql`drop schema drizzle cascade`);
  await fresh.db.execute(sql`create schema public`);
  await fresh.close();
});

afterAll(async () => {
  const fresh = await freshTestDb();
  await fresh.close();
});

describe("migrateAll", () => {
  it("applies Core then modules", async () => {
    await migrateAll(url, [demo], root);
    const { db, close } = createDb(url);
    try {
      const tables = await db.execute(
        sql`select table_name from information_schema.tables where table_schema = 'public' and table_name in ('items', 'demo_things')`,
      );
      expect(tables.map((r) => r.table_name).sort()).toEqual([
        "demo_things",
        "items",
      ]);
    } finally {
      await close();
    }
    expect(await count("__drizzle_migrations_demo")).toBe(1);
  });

  it("module journals are separate", async () => {
    const core = await count("__drizzle_migrations");
    await migrateAll(url, [demo], root);
    expect(await count("__drizzle_migrations")).toBe(core);
    expect(await count("__drizzle_migrations_demo")).toBe(1);
  });
});
