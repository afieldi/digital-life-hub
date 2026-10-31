import { items, links } from "@dlh/db";
import { eq } from "drizzle-orm";
import {
  getItem,
  linksForItem,
  listContained,
  listItems,
} from "../src/items/read";
import { writeItems } from "../src/items/writer";
import { freshTestDb, testDeps } from "../src/testing";

async function setup() {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db);
  const published: string[][] = [];
  deps.changes.subscribe((ids) => published.push(ids));
  async function mk(title: string) {
    return writeItems(deps, (w) => w.createItem({ type: "test", title }));
  }
  async function link(
    fromId: string,
    toId: string,
    kind: "contains" | "mentions" | "relates" = "contains",
  ) {
    return writeItems(deps, (w) => w.addLink({ fromId, toId, kind }));
  }
  async function del(id: string, deleted = true) {
    const [row] = await db.select().from(items).where(eq(items.id, id));
    return writeItems(deps, (w) =>
      w.setDeleted({
        id,
        expectedUpdatedAt: row.updatedAt.toISOString(),
        deleted,
      }),
    );
  }
  return { db, deps, published, close, mk, link, del };
}

test("addLink returns the existing link when repeated", async () => {
  const { db, mk, link, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const first = await link(a.id, b.id, "relates");
  const second = await link(a.id, b.id, "relates");
  expect(second.id).toBe(first.id);
  expect(await db.select().from(links)).toHaveLength(1);
  await close();
});

test("addLink and removeLink publish both ends; removeLink on a missing id is NOT_FOUND", async () => {
  const { deps, published, mk, link, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  published.length = 0;
  const l = await link(a.id, b.id, "mentions");
  expect([...published[0]].sort()).toEqual([a.id, b.id].sort());
  published.length = 0;
  await writeItems(deps, (w) => w.removeLink(l.id));
  expect([...published[0]].sort()).toEqual([a.id, b.id].sort());
  await expect(
    writeItems(deps, (w) => w.removeLink(l.id)),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await close();
});

test("tagged is BAD_REQUEST; missing or deleted ends are NOT_FOUND", async () => {
  const { deps, mk, del, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  await expect(
    writeItems(deps, (w) =>
      w.addLink({ fromId: a.id, toId: b.id, kind: "tagged" as never }),
    ),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    writeItems(deps, (w) =>
      w.addLink({
        fromId: a.id,
        toId: "00000000-0000-7000-8000-000000000000",
        kind: "relates",
      }),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await del(b.id);
  await expect(
    writeItems(deps, (w) =>
      w.addLink({ fromId: a.id, toId: b.id, kind: "relates" }),
    ),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await close();
});

test("a contains loop is refused", async () => {
  const { mk, link, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const c = await mk("C");
  await link(a.id, b.id);
  await link(b.id, c.id);
  await expect(link(c.id, a.id)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "would make an item contain itself",
  });
  await close();
});

test("concurrent adds can't form a loop", async () => {
  const { deps, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const results = await Promise.allSettled([
    writeItems(deps, (w) =>
      w.addLink({ fromId: a.id, toId: b.id, kind: "contains" }),
    ),
    writeItems(deps, (w) =>
      w.addLink({ fromId: b.id, toId: a.id, kind: "contains" }),
    ),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  await close();
});

test("loop check counts deleted items", async () => {
  const { mk, link, del, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  await link(a.id, b.id);
  await del(b.id);
  // B is deleted so the add is NOT_FOUND; restore it and the loop is refused.
  await del(b.id, false);
  await expect(link(b.id, a.id)).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await close();
});

test("loop check ignores deleted items in between", async () => {
  const { mk, link, del, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const c = await mk("C");
  await link(a.id, b.id);
  await link(b.id, c.id);
  await del(b.id);
  await expect(link(c.id, a.id)).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "would make an item contain itself",
  });
  await close();
});

test("listContained lists each item once via the shallowest path and hides deleted ones", async () => {
  const { db, mk, link, del, close } = await setup();
  const p = await mk("P");
  const n = await mk("N");
  const t = await mk("T");
  await link(p.id, n.id);
  await link(n.id, t.id);
  await link(p.id, t.id);
  const all = await listContained(db, p.id);
  expect(all.filter((r) => r.item.id === t.id)).toHaveLength(1);
  expect(all.find((r) => r.item.id === t.id)?.via.id).toBe(p.id);
  expect(all.find((r) => r.item.id === n.id)?.via.id).toBe(p.id);

  // Task reachable only through N.
  const only = await mk("Only");
  await link(n.id, only.id);
  expect((await listContained(db, p.id)).map((r) => r.item.id)).toContain(
    only.id,
  );
  await del(n.id);
  const hidden = (await listContained(db, p.id)).map((r) => r.item.id);
  expect(hidden).not.toContain(only.id);
  expect(hidden).not.toContain(n.id);
  expect(hidden).toContain(t.id);
  await del(n.id, false);
  expect((await listContained(db, p.id)).map((r) => r.item.id)).toContain(
    only.id,
  );
  await close();
});

test("linksForItem hides links whose other end is deleted; backlinks use to_id", async () => {
  const { db, mk, link, del, close } = await setup();
  const x = await mk("X");
  const y = await mk("Y");
  const z = await mk("Z");
  await link(x.id, y.id, "mentions");
  await link(z.id, x.id, "relates");
  const both = await linksForItem(db, x.id);
  expect(both.outgoing.map((l) => l.item.id)).toEqual([y.id]);
  expect(both.backlinks.map((l) => l.item.id)).toEqual([z.id]);
  expect(both.backlinks[0].toId).toBe(x.id);
  await del(y.id);
  await del(z.id);
  const after = await linksForItem(db, x.id);
  expect(after.outgoing).toEqual([]);
  expect(after.backlinks).toEqual([]);
  await close();
});

test("getItem is NOT_FOUND for missing or deleted", async () => {
  const { db, mk, del, close } = await setup();
  const a = await mk("A");
  expect((await getItem(db, a.id)).title).toBe("A");
  await del(a.id);
  await expect(getItem(db, a.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  await close();
});

test("listItems pages, hides archived unless asked, rejects limit 500", async () => {
  const { db, deps, mk, close } = await setup();
  for (const [i, title] of ["1", "2", "3"].entries()) {
    deps.setNow(new Date(Date.UTC(2026, 9, 30, 12, 0, i)));
    await mk(title);
  }
  const first = await listItems(db, { limit: 2 });
  expect(first.items.map((i) => i.title)).toEqual(["3", "2"]);
  expect(first.nextCursor).not.toBeNull();
  const second = await listItems(db, {
    limit: 2,
    cursor: first.nextCursor ?? undefined,
  });
  expect(second.items.map((i) => i.title)).toEqual(["1"]);
  expect(second.nextCursor).toBeNull();

  const top = first.items[0];
  await writeItems(deps, (w) =>
    w.setArchived({
      id: top.id,
      expectedUpdatedAt: top.updatedAt,
      archived: true,
    }),
  );
  expect((await listItems(db, {})).items).toHaveLength(2);
  expect((await listItems(db, { includeArchived: true })).items).toHaveLength(
    3,
  );
  await expect(listItems(db, { limit: 500 })).rejects.toMatchObject({
    code: "BAD_REQUEST",
  });
  await close();
});
