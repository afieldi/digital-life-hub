import { items } from "@dlh/db";
import { eq } from "drizzle-orm";
import { writeItems } from "../src/items/writer";
import {
  expectModuleWrites,
  expectTracked,
  freshTestDb,
  testDeps,
} from "../src/testing";
import type { DeleteWith } from "../src/trpc";

let parentId = "";

async function setup(hook: DeleteWith) {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db, { deleteWith: { test: hook } });
  return { db, deps, close };
}

const row = async (
  db: Awaited<ReturnType<typeof freshTestDb>>["db"],
  id: string,
) => (await db.select().from(items).where(eq(items.id, id)))[0];

async function family(deps: ReturnType<typeof testDeps>, n = 2) {
  return writeItems(deps, async (w) => {
    const parent = await w.createItem({ type: "test", title: "parent" });
    const kids = [];
    for (let i = 0; i < n; i++)
      kids.push(await w.createItem({ type: "test", title: `kid${i}` }));
    return { parent, kids };
  });
}

test("delete takes returned items with the same deleted_at", async () => {
  let kidIds: string[] = [];
  const { db, deps, close } = await setup(async (_tx, id) =>
    id === parentId ? kidIds : [],
  );
  const { parent, kids } = await family(deps);
  parentId = parent.id;
  kidIds = kids.map((k) => k.id);
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  await expectTracked(deps, { itemId: kids[0].id }, () =>
    writeItems(deps, (w) =>
      w.setDeleted({
        id: parent.id,
        expectedUpdatedAt: parent.updatedAt,
        deleted: true,
      }),
    ),
  );
  const p = await row(db, parent.id);
  for (const k of kids) {
    const r = await row(db, k.id);
    expect(r.deletedAt).toEqual(p.deletedAt);
    expect(r.deletedAt).not.toBeNull();
    expect(r.updatedAt > new Date(k.updatedAt)).toBe(true);
  }
  await close();
});
test("restore brings back only items deleted in that action", async () => {
  let kidIds: string[] = [];
  const { db, deps, close } = await setup(async (_tx, id) =>
    id === parentId ? kidIds : [],
  );
  const { parent, kids } = await family(deps);
  parentId = parent.id;
  kidIds = kids.map((k) => k.id);
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  // kids[0] was deleted earlier on its own.
  const k0 = await writeItems(deps, (w) =>
    w.setDeleted({
      id: kids[0].id,
      expectedUpdatedAt: kids[0].updatedAt,
      deleted: true,
    }),
  );
  deps.setNow(new Date("2026-10-30T14:00:00.000Z"));
  const del = await writeItems(deps, (w) =>
    w.setDeleted({
      id: parent.id,
      expectedUpdatedAt: parent.updatedAt,
      deleted: true,
    }),
  );
  deps.setNow(new Date("2026-10-30T15:00:00.000Z"));
  await writeItems(deps, (w) =>
    w.setDeleted({
      id: parent.id,
      expectedUpdatedAt: del.updatedAt,
      deleted: false,
    }),
  );
  expect((await row(db, parent.id)).deletedAt).toBeNull();
  expect((await row(db, kids[1].id)).deletedAt).toBeNull();
  expect((await row(db, kids[0].id)).deletedAt).not.toBeNull();
  expect(k0.id).toBe(kids[0].id);
  await close();
});

test("no hook behaves as before", async () => {
  const t = await freshTestDb();
  const deps = testDeps(t.db);
  const { parent, kids } = await family(deps, 1);
  const del = await writeItems(deps, (w) =>
    w.setDeleted({
      id: parent.id,
      expectedUpdatedAt: parent.updatedAt,
      deleted: true,
    }),
  );
  expect((await row(t.db, parent.id)).deletedAt).not.toBeNull();
  expect((await row(t.db, kids[0].id)).deletedAt).toBeNull();
  await writeItems(deps, (w) =>
    w.setDeleted({
      id: parent.id,
      expectedUpdatedAt: del.updatedAt,
      deleted: false,
    }),
  );
  expect((await row(t.db, parent.id)).deletedAt).toBeNull();
  await t.close();
});

test("rollback deletes nothing", async () => {
  const { db, deps, close } = await setup(async () => {
    throw new Error("hook failed");
  });
  const { parent } = await family(deps, 0);
  await expect(
    writeItems(deps, (w) =>
      w.setDeleted({
        id: parent.id,
        expectedUpdatedAt: parent.updatedAt,
        deleted: true,
      }),
    ),
  ).rejects.toThrow("hook failed");
  expect((await row(db, parent.id)).deletedAt).toBeNull();
  await close();
});

test("expectModuleWrites passes when the write bumps updated_at and publishes", async () => {
  const { deps, close } = await setup(async () => []);
  const { parent } = await family(deps, 0);
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  await expectModuleWrites(
    deps,
    (id) =>
      writeItems(deps, (w) =>
        w.updateItem({ id, expectedUpdatedAt: parent.updatedAt, title: "x" }),
      ),
    parent.id,
  );
  await close();
});
