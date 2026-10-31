import { sql } from "drizzle-orm";
import { sessions } from "../src";
import { freshTestDb } from "../src/testing";

test("migrations create sessions with uuidv7 ids", async () => {
  const { db, close } = await freshTestDb();
  const [row] = await db
    .insert(sessions)
    .values({
      tokenHash: "h",
      email: "a@example.com",
      deviceName: "Mac",
      platform: "macos",
      lastUsedAt: new Date(),
      expiresAt: new Date(Date.now() + 1000),
    })
    .returning();
  expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  const tables = await db.execute(
    sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`,
  );
  expect(tables.map((t) => t.table_name)).toEqual([
    "item_views",
    "items",
    "links",
    "login_attempts",
    "sessions",
  ]);
  await close();
});

test("freshTestDb starts empty every time", async () => {
  const a = await freshTestDb();
  await a.db.insert(sessions).values({
    tokenHash: "x",
    email: "e",
    deviceName: "d",
    platform: "web",
    lastUsedAt: new Date(),
    expiresAt: new Date(),
  });
  await a.close();
  const b = await freshTestDb();
  expect(await b.db.select().from(sessions)).toEqual([]);
  await b.close();
});
