import { items, itemViews } from "@dlh/db";
import { eq } from "drizzle-orm";
import { purgeExpired } from "../src/items/purge";
import { listRecents, recordView } from "../src/items/recents";
import { writeItems } from "../src/items/writer";
import { freshTestDb, testDeps } from "../src/testing";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const T0 = new Date("2026-10-30T12:00:00.000Z");

async function setup() {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db);
  const mk = (title: string) =>
    writeItems(deps, (w) => w.createItem({ type: "test", title }));
  return { db, deps, close, mk };
}

test("views within 5 minutes collapse; later ones are recorded", async () => {
  const { db, deps, mk, close } = await setup();
  const a = await mk("A");
  await recordView(deps, a.id);
  deps.setNow(new Date(T0.getTime() + 4 * MIN));
  await recordView(deps, a.id);
  expect(await db.select().from(itemViews)).toHaveLength(1);
  deps.setNow(new Date(T0.getTime() + 6 * MIN));
  await recordView(deps, a.id);
  expect(await db.select().from(itemViews)).toHaveLength(2);
  await close();
});

test("recordView is NOT_FOUND for missing or deleted items and publishes nothing", async () => {
  const { db, deps, mk, close } = await setup();
  const published: string[][] = [];
  deps.changes.subscribe((ids) => published.push(ids));
  await expect(
    recordView(deps, "019a0000-0000-7000-8000-000000000000"),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const a = await mk("A");
  await db.update(items).set({ deletedAt: T0 }).where(eq(items.id, a.id));
  published.length = 0;
  await expect(recordView(deps, a.id)).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  expect(published).toEqual([]);
  await close();
});

test("listRecents is at most 10 distinct items, newest first, skipping deleted", async () => {
  const { db, deps, mk, close } = await setup();
  const made = [];
  for (let i = 0; i < 12; i++) {
    const it = await mk(`Item ${i}`);
    made.push(it);
    deps.setNow(new Date(T0.getTime() + i * 10 * MIN));
    await recordView(deps, it.id);
  }
  // view item 5 again, later, so it is newest
  deps.setNow(new Date(T0.getTime() + 200 * MIN));
  await recordView(deps, made[5].id);
  await db
    .update(items)
    .set({ deletedAt: T0 })
    .where(eq(items.id, made[11].id));
  const res = await listRecents(db);
  expect(res).toHaveLength(10);
  expect(res.map((r) => r.title)).toEqual([
    "Item 5",
    "Item 10",
    "Item 9",
    "Item 8",
    "Item 7",
    "Item 6",
    "Item 4",
    "Item 3",
    "Item 2",
    "Item 1",
  ]);
  await close();
});

test("purgeExpired removes items deleted over 30 days ago and views over 90 days old", async () => {
  const { db, deps, mk, close } = await setup();
  const old = await mk("old");
  const recent = await mk("recent");
  const live = await mk("live");
  await db
    .update(items)
    .set({ deletedAt: new Date(T0.getTime() - 31 * DAY) })
    .where(eq(items.id, old.id));
  await db
    .update(items)
    .set({ deletedAt: new Date(T0.getTime() - 29 * DAY) })
    .where(eq(items.id, recent.id));
  await db.insert(itemViews).values([
    { itemId: live.id, viewedAt: new Date(T0.getTime() - 91 * DAY) },
    { itemId: live.id, viewedAt: new Date(T0.getTime() - 89 * DAY) },
  ]);
  const res = await purgeExpired(deps);
  expect(res).toEqual({ items: 1, views: 1 });
  const left = (await db.select().from(items)).map((r) => r.title).sort();
  expect(left).toEqual(["live", "recent"]);
  expect(await db.select().from(itemViews)).toHaveLength(1);
  await close();
});
