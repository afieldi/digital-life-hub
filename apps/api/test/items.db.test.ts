import { writeItems } from "@dlh/server";
import { freshTestDb } from "@dlh/server/testing";
import { TRPCClientError } from "@trpc/client";
import { seedIfEmpty } from "../src/cli/seed";
import { serverModules } from "../src/modules.gen";
import { createTestApi } from "../src/testing";

async function setup() {
  const t = await freshTestDb();
  const api = createTestApi({ db: t.db, devAuth: true, itemTypes: ["test"] });
  const token = await api.signIn();
  const c = api.client(token);
  const mk = (title: string, searchText?: string) =>
    writeItems(api.deps, (w) =>
      w.createItem({ type: "test", title, searchText }),
    );
  return { api, c, mk, close: t.close };
}

async function codeOf(p: Promise<unknown>): Promise<string | undefined> {
  try {
    await p;
  } catch (e) {
    if (e instanceof TRPCClientError) return e.data?.code;
    throw e;
  }
  return undefined;
}

test("every call without a token is UNAUTHORIZED", async () => {
  const { api, close } = await setup();
  const c = api.client();
  const id = "0197a000-0000-7000-8000-000000000000";
  const v = { id, expectedUpdatedAt: "2026-10-30T12:00:00.000Z" };
  const calls = [
    c.items.get.query({ id }),
    c.items.list.query({}),
    c.items.rename.mutate({ ...v, title: "x" }),
    c.items.archive.mutate(v),
    c.items.unarchive.mutate(v),
    c.items.delete.mutate(v),
    c.items.restore.mutate(v),
    c.links.add.mutate({ fromId: id, toId: id, kind: "relates" }),
    c.links.remove.mutate({ id }),
    c.links.forItem.query({ id }),
    c.links.contained.query({ id }),
    c.search.query({ query: "x" }),
    c.recents.list.query(),
    c.recents.record.mutate({ id }),
  ];
  for (const call of calls) expect(await codeOf(call)).toBe("UNAUTHORIZED");
  await close();
});

test("rename round-trip, stale rename conflicts, search finds the new title", async () => {
  const { c, mk, close } = await setup();
  const a = await mk("Old title", "secret body words");
  const renamed = await c.items.rename.mutate({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
    title: "Quarterly planning",
  });
  expect(renamed.title).toBe("Quarterly planning");
  expect(renamed.updatedAt > a.updatedAt).toBe(true);
  expect((await c.items.get.query({ id: a.id })).title).toBe(
    "Quarterly planning",
  );
  expect(
    await codeOf(
      c.items.rename.mutate({
        id: a.id,
        expectedUpdatedAt: a.updatedAt,
        title: "Stale",
      }),
    ),
  ).toBe("CONFLICT");
  const found = await c.search.query({ query: "quarterly" });
  expect(found.map((i) => i.id)).toEqual([a.id]);
  await close();
});

test("archive, delete and restore round-trip; list paging", async () => {
  const { c, mk, close } = await setup();
  const a = await mk("A");
  await mk("B");
  const arch = await c.items.archive.mutate({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
  });
  expect(arch.archivedAt).not.toBeNull();
  expect((await c.items.list.query({})).items).toHaveLength(1);
  expect(
    (await c.items.list.query({ includeArchived: true })).items,
  ).toHaveLength(2);
  const un = await c.items.unarchive.mutate({
    id: a.id,
    expectedUpdatedAt: arch.updatedAt,
  });
  const del = await c.items.delete.mutate({
    id: a.id,
    expectedUpdatedAt: un.updatedAt,
  });
  expect(await codeOf(c.items.get.query({ id: a.id }))).toBe("NOT_FOUND");
  await c.items.restore.mutate({ id: a.id, expectedUpdatedAt: del.updatedAt });
  expect((await c.items.get.query({ id: a.id })).id).toBe(a.id);
  const page = await c.items.list.query({ limit: 1 });
  expect(page.items).toHaveLength(1);
  expect(page.nextCursor).not.toBeNull();
  await close();
});

test("recents.record then recents.list", async () => {
  const { c, mk, close } = await setup();
  const a = await mk("Viewed");
  await mk("Never viewed");
  await c.recents.record.mutate({ id: a.id });
  expect((await c.recents.list.query()).map((i) => i.id)).toEqual([a.id]);
  await close();
});

test("links add, forItem, contained, remove; loops are rejected", async () => {
  const { c, mk, close } = await setup();
  const [a, b, d] = [await mk("A"), await mk("B"), await mk("D")];
  const l1 = await c.links.add.mutate({
    fromId: a.id,
    toId: b.id,
    kind: "contains",
  });
  await c.links.add.mutate({ fromId: b.id, toId: d.id, kind: "contains" });
  expect(
    (await c.links.add.mutate({ fromId: a.id, toId: b.id, kind: "contains" }))
      .id,
  ).toBe(l1.id);
  const fa = await c.links.forItem.query({ id: a.id });
  expect(fa.outgoing.map((l) => l.item.id)).toEqual([b.id]);
  expect(
    (await c.links.forItem.query({ id: b.id })).backlinks[0]?.item.id,
  ).toBe(a.id);
  const contained = await c.links.contained.query({ id: a.id });
  expect(contained.map((x) => x.item.id).sort()).toEqual([b.id, d.id].sort());
  expect(contained.find((x) => x.item.id === d.id)?.via.id).toBe(b.id);
  await expect(
    c.links.add.mutate({ fromId: d.id, toId: a.id, kind: "contains" }),
  ).rejects.toThrow("would make an item contain itself");
  await c.links.remove.mutate({ id: l1.id });
  expect((await c.links.forItem.query({ id: a.id })).outgoing).toEqual([]);
  await close();
});

test("links.forItem and links.contained are NOT_FOUND for a missing or deleted root", async () => {
  const { c, mk, close } = await setup();
  const a = await mk("A");
  const missing = "0197a000-0000-7000-8000-000000000000";
  expect(await codeOf(c.links.forItem.query({ id: missing }))).toBe(
    "NOT_FOUND",
  );
  expect(await codeOf(c.links.contained.query({ id: missing }))).toBe(
    "NOT_FOUND",
  );
  await c.items.delete.mutate({ id: a.id, expectedUpdatedAt: a.updatedAt });
  expect(await codeOf(c.links.forItem.query({ id: a.id }))).toBe("NOT_FOUND");
  expect(await codeOf(c.links.contained.query({ id: a.id }))).toBe("NOT_FOUND");
  await close();
});

test("a non-uuid id is BAD_REQUEST", async () => {
  const { c, close } = await setup();
  expect(await codeOf(c.items.get.query({ id: "nope" }))).toBe("BAD_REQUEST");
  expect(await codeOf(c.links.forItem.query({ id: "nope" }))).toBe(
    "BAD_REQUEST",
  );
  expect(await codeOf(c.recents.record.mutate({ id: "nope" }))).toBe(
    "BAD_REQUEST",
  );
  expect(
    await codeOf(
      c.links.add.mutate({ fromId: "nope", toId: "nope", kind: "relates" }),
    ),
  ).toBe("BAD_REQUEST");
  expect(await codeOf(c.links.remove.mutate({ id: "nope" }))).toBe(
    "BAD_REQUEST",
  );
  await close();
});

test("outputs never contain searchText", async () => {
  const { c, mk, close } = await setup();
  const a = await mk("Findable", "hidden-body-text");
  const b = await mk("Other");
  await c.links.add.mutate({ fromId: a.id, toId: b.id, kind: "contains" });
  await c.recents.record.mutate({ id: a.id });
  const outputs = [
    await c.items.get.query({ id: a.id }),
    await c.items.list.query({}),
    await c.search.query({ query: "hidden" }),
    await c.search.query({ query: "Findable" }),
    await c.recents.list.query(),
    await c.links.forItem.query({ id: a.id }),
    await c.links.contained.query({ id: a.id }),
  ];
  const json = JSON.stringify(outputs);
  expect(json).not.toContain("hidden-body-text");
  expect(json).not.toMatch(/searchText|search_text/);
  await close();
});

test("sample.create is reachable through the app router", async () => {
  const { c, close } = await setup();
  const item = await c.sample.create.mutate({ title: " From the app " });
  expect(item).toMatchObject({ type: "sample", title: "From the app" });
  expect((await c.items.get.query({ id: item.id })).id).toBe(item.id);
  await close();
});

test("seedIfEmpty seeds an empty database once", async () => {
  const { api, c, close } = await setup();
  expect(await seedIfEmpty(api.deps, serverModules)).toBe(true);
  const seeded = (await c.items.list.query({ limit: 200 })).items;
  expect(seeded.length).toBeGreaterThan(0);
  expect(await seedIfEmpty(api.deps, serverModules)).toBe(false);
  expect((await c.items.list.query({ limit: 200 })).items).toHaveLength(
    seeded.length,
  );
  await close();
});
