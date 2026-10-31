import { items } from "@dlh/db";
import { eq } from "drizzle-orm";
import { writeItems } from "../src/items/writer";
import { expectTracked, freshTestDb, testDeps } from "../src/testing";

const NOW = new Date("2026-10-30T12:00:00.000Z");

async function setup() {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db, { now: () => NOW });
  const published: string[][] = [];
  deps.changes.subscribe((ids) => published.push(ids));
  return { db, deps, published, close };
}

test("createItem trims the title, stamps created/updated from deps.now and publishes after commit", async () => {
  const { deps, published, close } = await setup();
  let during: string[][] = [];
  const item = await writeItems(deps, async (w) => {
    const created = await w.createItem({ type: "test", title: "  Hello  " });
    during = [...published];
    return created;
  });
  expect(during).toEqual([]);
  expect(published).toEqual([[item.id]]);
  expect(item.title).toBe("Hello");
  expect(item.createdAt).toBe(NOW.toISOString());
  expect(item.updatedAt).toBe(NOW.toISOString());
  expect(item.archivedAt).toBeNull();
  await close();
});

test("rolled back writes publish nothing", async () => {
  const { db, deps, published, close } = await setup();
  await expect(
    writeItems(deps, async (w) => {
      await w.createItem({ type: "test", title: "x" });
      throw new Error("boom");
    }),
  ).rejects.toThrow("boom");
  expect(published).toEqual([]);
  expect(await db.select().from(items)).toHaveLength(0);
  await close();
});

test("unknown type and blank title are BAD_REQUEST", async () => {
  const { deps, close } = await setup();
  await expect(
    writeItems(deps, (w) => w.createItem({ type: "nope", title: "x" })),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    writeItems(deps, (w) => w.createItem({ type: "test", title: "   " })),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await close();
});

test("updateItem with a stale expectedUpdatedAt is CONFLICT; missing or deleted is NOT_FOUND", async () => {
  const { deps, close } = await setup();
  const a = await writeItems(deps, (w) =>
    w.createItem({ type: "test", title: "a" }),
  );
  await writeItems(deps, (w) =>
    w.updateItem({ id: a.id, expectedUpdatedAt: a.updatedAt, title: "b" }),
  );
  await expect(
    writeItems(deps, (w) =>
      w.updateItem({ id: a.id, expectedUpdatedAt: a.updatedAt, title: "c" }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    writeItems(deps, (w) =>
      w.updateItem({
        id: "019a0000-0000-7000-8000-000000000000",
        expectedUpdatedAt: a.updatedAt,
        title: "c",
      }),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const cur = await writeItems(deps, (w) =>
    w.setDeleted({ id: a.id, expectedUpdatedAt: a.updatedAt, deleted: true }),
  ).catch((e) => e);
  expect(cur).toMatchObject({ code: "CONFLICT" });
  await close();
});

test("two updates in the same millisecond still advance updated_at", async () => {
  const { deps, close } = await setup();
  const a = await writeItems(deps, (w) =>
    w.createItem({ type: "test", title: "a" }),
  );
  const t1 = (
    await writeItems(deps, (w) =>
      w.updateItem({ id: a.id, expectedUpdatedAt: a.updatedAt, title: "b" }),
    )
  ).updatedAt;
  const t2 = (
    await writeItems(deps, (w) =>
      w.updateItem({ id: a.id, expectedUpdatedAt: t1, title: "c" }),
    )
  ).updatedAt;
  expect(t2 > t1).toBe(true);
  await expect(
    writeItems(deps, (w) =>
      w.updateItem({ id: a.id, expectedUpdatedAt: t1, title: "d" }),
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await close();
});

test("updated_at round-trips exactly", async () => {
  const { deps, close } = await setup();
  const a = await writeItems(deps, (w) =>
    w.createItem({ type: "test", title: "a" }),
  );
  const b = await writeItems(deps, (w) =>
    w.updateItem({ id: a.id, expectedUpdatedAt: a.updatedAt, title: "b" }),
  );
  await expect(
    writeItems(deps, (w) =>
      w.updateItem({ id: a.id, expectedUpdatedAt: b.updatedAt, title: "c" }),
    ),
  ).resolves.toMatchObject({ title: "c" });
  await close();
});

test("setDeleted(true) then setDeleted(false) restores; setArchived sets and clears archivedAt", async () => {
  const { deps, close } = await setup();
  const a = await writeItems(deps, (w) =>
    w.createItem({ type: "test", title: "a" }),
  );
  const d = await writeItems(deps, (w) =>
    w.setDeleted({ id: a.id, expectedUpdatedAt: a.updatedAt, deleted: true }),
  );
  await expect(
    writeItems(deps, (w) =>
      w.updateItem({ id: a.id, expectedUpdatedAt: d.updatedAt, title: "x" }),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  const r = await writeItems(deps, (w) =>
    w.setDeleted({ id: a.id, expectedUpdatedAt: d.updatedAt, deleted: false }),
  );
  const ar = await writeItems(deps, (w) =>
    w.setArchived({ id: a.id, expectedUpdatedAt: r.updatedAt, archived: true }),
  );
  expect(ar.archivedAt).toBe(NOW.toISOString());
  const un = await writeItems(deps, (w) =>
    w.setArchived({
      id: a.id,
      expectedUpdatedAt: ar.updatedAt,
      archived: false,
    }),
  );
  expect(un.archivedAt).toBeNull();
  await close();
});

test("updateItem with no fields still advances the version and publishes", async () => {
  const { db, deps, close } = await setup();
  const a = await writeItems(deps, (w) =>
    w.createItem({ type: "test", title: "a" }),
  );
  await expectTracked(deps, { itemId: a.id }, () =>
    writeItems(deps, (w) =>
      w.updateItem({ id: a.id, expectedUpdatedAt: a.updatedAt }),
    ),
  );
  const [row] = await db.select().from(items).where(eq(items.id, a.id));
  expect(row.updatedAt.toISOString() > a.updatedAt).toBe(true);
  await close();
});
