import { sql } from "drizzle-orm";
import { items, itemViews, links } from "../src";
import { freshTestDb } from "../src/testing";

test("search is generated from title (A) and search_text (B)", async () => {
  const { db, close } = await freshTestDb();
  await db.insert(items).values({
    type: "t",
    title: "Quarterly planning",
    searchText: "vendor contracts",
  });
  const [row] = await db.execute(
    sql`select ts_rank(search, to_tsquery('english','plan')) > ts_rank(search, to_tsquery('english','vendor')) as ok from items`,
  );
  expect(row.ok).toBe(true);
  await close();
});

test("pg_trgm is installed", async () => {
  const { db, close } = await freshTestDb();
  const [row] = await db.execute(
    sql`select similarity('planning','planing') > 0.3 as ok`,
  );
  expect(row.ok).toBe(true);
  await close();
});

async function twoItems(db: Awaited<ReturnType<typeof freshTestDb>>["db"]) {
  const [a, b] = await db
    .insert(items)
    .values([
      { type: "t", title: "A" },
      { type: "t", title: "B" },
    ])
    .returning();
  return [a, b] as const;
}

test("links reject self-links and duplicates", async () => {
  const { db, close } = await freshTestDb();
  const [a, b] = await twoItems(db);
  await expect(
    db.insert(links).values({ fromId: a.id, toId: a.id, kind: "relates" }),
  ).rejects.toThrow();
  await db.insert(links).values({ fromId: a.id, toId: b.id, kind: "relates" });
  await expect(
    db.insert(links).values({ fromId: a.id, toId: b.id, kind: "relates" }),
  ).rejects.toThrow();
  await close();
});

test("deleting an item cascades to links and views", async () => {
  const { db, close } = await freshTestDb();
  const [a, b] = await twoItems(db);
  await db.insert(links).values({ fromId: a.id, toId: b.id, kind: "contains" });
  await db.insert(itemViews).values({ itemId: a.id, viewedAt: new Date() });
  await db.delete(items).where(sql`id = ${a.id}`);
  const [counts] = await db.execute(
    sql`select (select count(*) from links)::int as l, (select count(*) from item_views)::int as v`,
  );
  expect(counts).toEqual({ l: 0, v: 0 });
  await close();
});
