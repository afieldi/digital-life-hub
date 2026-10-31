import { items } from "@dlh/db";
import { eq } from "drizzle-orm";
import { searchItems } from "../src/items/search";
import { writeItems } from "../src/items/writer";
import { freshTestDb, testDeps } from "../src/testing";

async function setup() {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db, { itemTypes: ["test", "other"] });
  async function mk(title: string, searchText?: string, type = "test") {
    return writeItems(deps, (w) => w.createItem({ type, title, searchText }));
  }
  async function patch(id: string, set: Partial<typeof items.$inferInsert>) {
    await db.update(items).set(set).where(eq(items.id, id));
  }
  return { db, deps, close, mk, patch };
}

const titles = async (p: ReturnType<typeof searchItems>) =>
  (await p).map((r) => r.title);

test("stemming, trigram typo and one-letter prefix matches", async () => {
  const { db, mk, close } = await setup();
  await mk("Quarterly planning");
  await mk("Q4 review");
  expect(await titles(searchItems(db, { query: "plan" }))).toContain(
    "Quarterly planning",
  );
  expect(await titles(searchItems(db, { query: "plnning" }))).toContain(
    "Quarterly planning",
  );
  expect(await titles(searchItems(db, { query: "q" }))).toContain("Q4 review");
  await close();
});

test("a title match outranks a search_text-only match", async () => {
  const { db, mk, close } = await setup();
  await mk("Groceries", "remember the zebra stripes");
  await mk("Zebra notes");
  expect(await titles(searchItems(db, { query: "zebra" }))).toEqual([
    "Zebra notes",
    "Groceries",
  ]);
  await close();
});

test("an archived item ranks below an equal live one", async () => {
  const { db, deps, mk, patch, close } = await setup();
  await mk("Budget");
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  const a = await mk("Budget"); // newer, so only the penalty can push it down
  await patch(a.id, { archivedAt: new Date() });
  const res = await searchItems(db, { query: "budget" });
  expect(res).toHaveLength(2);
  expect(res[0].archivedAt).toBeNull();
  expect(res[1].id).toBe(a.id);
  await close();
});

test("deleted items never appear; types filters", async () => {
  const { db, mk, patch, close } = await setup();
  const gone = await mk("Gadget one");
  await mk("Gadget two", undefined, "other");
  await mk("Gadget three");
  await patch(gone.id, { deletedAt: new Date() });
  expect((await titles(searchItems(db, { query: "gadget" }))).sort()).toEqual([
    "Gadget three",
    "Gadget two",
  ]);
  expect(
    await titles(searchItems(db, { query: "gadget", types: ["other"] })),
  ).toEqual(["Gadget two"]);
  await close();
});

test("an empty types list matches nothing", async () => {
  const { db, mk, close } = await setup();
  await mk("Widget");
  expect(await searchItems(db, { query: "widget", types: [] })).toEqual([]);
  await close();
});

test("blank query returns [] and an oversize limit is BAD_REQUEST", async () => {
  const { db, close } = await setup();
  expect(await searchItems(db, { query: "   " })).toEqual([]);
  await expect(
    searchItems(db, { query: "x", limit: 51 }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(searchItems(db, { query: "x", limit: 0 })).rejects.toMatchObject(
    { code: "BAD_REQUEST" },
  );
  await close();
});

test("hostile input never throws, and 50% does not prefix-match 500", async () => {
  const { db, mk, close } = await setup();
  await mk("500 items");
  await mk("100% done");
  for (const query of [
    "%",
    "_",
    "\\",
    "'",
    "a & b",
    "foo:*",
    "!",
    "the",
    "🚀",
    "x".repeat(1000),
  ]) {
    await expect(searchItems(db, { query })).resolves.toBeInstanceOf(Array);
  }
  expect(await titles(searchItems(db, { query: "50%" }))).not.toContain(
    "500 items",
  );
  await close();
});
