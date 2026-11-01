import { items, links } from "@dlh/db";
import { eq } from "drizzle-orm";
import { scopedWriter, writeItems } from "../src";
import { freshTestDb, testDeps } from "../src/testing";

const FORBIDDEN = { code: "FORBIDDEN" };

async function setup() {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db, { itemTypes: ["test"] });
  const a = await writeItems(deps, (w) =>
    w.createItem({ type: "test", title: "A" }),
  );
  const b = await writeItems(deps, (w) =>
    w.createItem({ type: "test", title: "B" }),
  );
  return { db, deps, a, b, close };
}

test("only allowed methods exist", async () => {
  const { deps, a, close } = await setup();
  await writeItems(deps, async (w) => {
    const s = scopedWriter(w, { effects: ["updateItem"], itemId: a.id });
    expect(s.updateItem).toBeDefined();
    expect(s.setDeleted).toBeUndefined();
    expect(s.createItem).toBeUndefined();
    expect(s.addLink).toBeUndefined();
    expect(s.setArchived).toBeUndefined();
    expect(s).not.toHaveProperty("removeLink");
    const all = scopedWriter(w, {
      effects: ["createItems", "addLinks", "deleteItems", "setArchived"],
      itemId: a.id,
    });
    expect(all.createItem).toBeDefined();
    expect(all.addLink).toBeDefined();
    expect(all.setDeleted).toBeDefined();
    expect(all.setArchived).toBeDefined();
    expect(all.updateItem).toBeUndefined();
    expect(all).not.toHaveProperty("removeLink");
  });
  await close();
});

test("updateItem on another id is forbidden and rolls back earlier writes", async () => {
  const { db, deps, a, b, close } = await setup();
  await expect(
    writeItems(deps, async (w) => {
      const s = scopedWriter(w, { effects: ["updateItem"], itemId: a.id });
      await s.updateItem?.({
        id: a.id,
        expectedUpdatedAt: a.updatedAt,
        title: "A2",
      });
      await s.updateItem?.({
        id: b.id,
        expectedUpdatedAt: b.updatedAt,
        title: "B2",
      });
    }),
  ).rejects.toMatchObject(FORBIDDEN);
  const [row] = await db.select().from(items).where(eq(items.id, a.id));
  expect(row?.title).toBe("A");
  await close();
});

test("addLink only from the scope item; writeOtherItems lifts it", async () => {
  const { db, deps, a, b, close } = await setup();
  await writeItems(deps, async (w) => {
    const s = scopedWriter(w, { effects: ["addLinks"], itemId: a.id });
    await s.addLink?.({ fromId: a.id, toId: b.id, kind: "relates" });
  });
  await expect(
    writeItems(deps, async (w) => {
      const s = scopedWriter(w, { effects: ["addLinks"], itemId: a.id });
      await s.addLink?.({ fromId: b.id, toId: a.id, kind: "relates" });
    }),
  ).rejects.toMatchObject(FORBIDDEN);
  await writeItems(deps, async (w) => {
    const s = scopedWriter(w, {
      effects: ["addLinks", "writeOtherItems"],
      itemId: a.id,
    });
    await s.addLink?.({ fromId: b.id, toId: a.id, kind: "relates" });
  });
  const rows = await db.select().from(links);
  expect(rows.map((r) => `${r.fromId}>${r.toId}`).sort()).toEqual(
    [`${a.id}>${b.id}`, `${b.id}>${a.id}`].sort(),
  );
  await close();
});

test("setDeleted is limited to scope item without writeOtherItems", async () => {
  const { db, deps, a, b, close } = await setup();
  await expect(
    writeItems(deps, async (w) => {
      const s = scopedWriter(w, { effects: ["deleteItems"], itemId: a.id });
      await s.setDeleted?.({
        id: b.id,
        expectedUpdatedAt: b.updatedAt,
        deleted: true,
      });
    }),
  ).rejects.toMatchObject(FORBIDDEN);
  await writeItems(deps, async (w) => {
    const s = scopedWriter(w, {
      effects: ["deleteItems", "writeOtherItems"],
      itemId: a.id,
    });
    await s.setDeleted?.({
      id: b.id,
      expectedUpdatedAt: b.updatedAt,
      deleted: true,
    });
  });
  const [row] = await db.select().from(items).where(eq(items.id, b.id));
  expect(row?.deletedAt).not.toBeNull();
  await close();
});

test("writeOtherItems alone exposes no write method", async () => {
  const { deps, a, close } = await setup();
  await writeItems(deps, async (w) => {
    const s = scopedWriter(w, { effects: ["writeOtherItems"], itemId: a.id });
    for (const m of [
      "updateItem",
      "setDeleted",
      "setArchived",
      "addLink",
      "createItem",
      "removeLink",
    ]) {
      expect(s).not.toHaveProperty(m);
    }
  });
  await close();
});

test("updateItem + writeOtherItems updates another item", async () => {
  const { db, deps, a, b, close } = await setup();
  await writeItems(deps, async (w) => {
    const s = scopedWriter(w, {
      effects: ["updateItem", "writeOtherItems"],
      itemId: a.id,
    });
    await s.updateItem?.({
      id: b.id,
      expectedUpdatedAt: b.updatedAt,
      title: "B2",
    });
  });
  const [row] = await db.select().from(items).where(eq(items.id, b.id));
  expect(row?.title).toBe("B2");
  await close();
});

test("setArchived is limited to the scope item", async () => {
  const { db, deps, a, b, close } = await setup();
  await expect(
    writeItems(deps, async (w) => {
      const s = scopedWriter(w, { effects: ["setArchived"], itemId: a.id });
      await s.setArchived?.({
        id: b.id,
        expectedUpdatedAt: b.updatedAt,
        archived: true,
      });
    }),
  ).rejects.toMatchObject(FORBIDDEN);
  await writeItems(deps, async (w) => {
    const s = scopedWriter(w, { effects: ["setArchived"], itemId: a.id });
    await s.setArchived?.({
      id: a.id,
      expectedUpdatedAt: a.updatedAt,
      archived: true,
    });
  });
  const [row] = await db.select().from(items).where(eq(items.id, a.id));
  expect(row?.archivedAt).not.toBeNull();
  const [other] = await db.select().from(items).where(eq(items.id, b.id));
  expect(other?.archivedAt).toBeNull();
  await close();
});
