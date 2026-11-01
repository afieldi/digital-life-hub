import { aiRequests, items, itemViews } from "@dlh/db";
import { eq } from "drizzle-orm";
import { purgeExpired } from "../src/items/purge";
import { freshTestDb, testDeps } from "../src/testing";

const MIN = 60_000;
const DAY = 24 * 60 * MIN;
const NOW = new Date("2026-10-30T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW.getTime() - ms);

async function setup() {
  const { db, close } = await freshTestDb();
  const deps = testDeps(db, { now: () => NOW });
  let n = 0;
  const req = async (
    over: Partial<typeof aiRequests.$inferInsert> = {},
  ): Promise<string> => {
    const [row] = await db
      .insert(aiRequests)
      .values({
        actionId: `a${n++}`,
        kind: "suggest",
        provider: "openrouter",
        status: "answered",
        createdAt: NOW,
        ...over,
      })
      .returning({ id: aiRequests.id });
    return row!.id;
  };
  const get = async (id: string) =>
    (await db.select().from(aiRequests).where(eq(aiRequests.id, id)))[0];
  return { db, deps, req, get, close };
}

test("still purges old soft-deleted items and views", async () => {
  const { db, deps, close } = await setup();
  const [old] = await db
    .insert(items)
    .values({ type: "t", title: "old", deletedAt: ago(31 * DAY) })
    .returning();
  const [live] = await db
    .insert(items)
    .values({ type: "t", title: "live" })
    .returning();
  await db.insert(itemViews).values([
    { itemId: live!.id, viewedAt: ago(91 * DAY) },
    { itemId: live!.id, viewedAt: ago(89 * DAY) },
  ]);
  const res = await purgeExpired(deps);
  expect(res).toEqual({
    items: 1,
    views: 1,
    aiRequests: 0,
    aiUndoCleared: 0,
    aiExpired: 0,
  });
  expect((await db.select().from(items)).map((r) => r.id)).toEqual([live!.id]);
  expect(old).toBeDefined();
  await close();
});

test("deletes ai_requests older than 90 days and keeps newer", async () => {
  const { db, deps, req, close } = await setup();
  const old = await req({ createdAt: ago(91 * DAY) });
  const fresh = await req({ createdAt: ago(89 * DAY) });
  const res = await purgeExpired(deps);
  expect(res.aiRequests).toBe(1);
  const ids = (await db.select().from(aiRequests)).map((r) => r.id);
  expect(ids).toEqual([fresh]);
  expect(ids).not.toContain(old);
  await close();
});

test("nulls undo older than 30 days by finished_at, falling back to created_at", async () => {
  const { deps, req, get, close } = await setup();
  const undo = { changes: [] };
  const oldFinished = await req({
    undo,
    createdAt: ago(35 * DAY),
    finishedAt: ago(31 * DAY),
  });
  const recentFinished = await req({
    undo,
    createdAt: ago(40 * DAY),
    finishedAt: ago(29 * DAY),
  });
  const oldCreated = await req({ undo, createdAt: ago(31 * DAY) });
  const recentCreated = await req({ undo, createdAt: ago(29 * DAY) });
  const res = await purgeExpired(deps);
  expect(res.aiUndoCleared).toBe(2);
  expect((await get(oldFinished))!.undo).toBeNull();
  expect((await get(recentFinished))!.undo).toEqual(undo);
  expect((await get(oldCreated))!.undo).toBeNull();
  expect((await get(recentCreated))!.undo).toEqual(undo);
  await close();
});

test("expires pending after 5 minutes and suggested after 30, clearing output", async () => {
  const { deps, req, get, close } = await setup();
  const output = { options: [1] };
  const oldPending = await req({
    status: "pending",
    output,
    createdAt: ago(6 * MIN),
  });
  const freshPending = await req({
    status: "pending",
    output,
    createdAt: ago(4 * MIN),
  });
  const oldSuggested = await req({
    status: "suggested",
    output,
    createdAt: ago(31 * MIN),
  });
  const freshSuggested = await req({
    status: "suggested",
    output,
    createdAt: ago(29 * MIN),
  });
  const midPending = await req({
    status: "pending",
    createdAt: ago(10 * MIN),
  });
  const res = await purgeExpired(deps);
  expect(res.aiExpired).toBe(3);
  for (const id of [oldPending, oldSuggested, midPending]) {
    const r = (await get(id))!;
    expect(r.status).toBe("expired");
    expect(r.output).toBeNull();
    expect(r.finishedAt).toEqual(NOW);
  }
  expect((await get(freshPending))!.status).toBe("pending");
  expect((await get(freshPending))!.output).toEqual(output);
  expect((await get(freshSuggested))!.status).toBe("suggested");
  await close();
});

test("purging an item sets ai_requests.item_id to null", async () => {
  const { db, deps, req, get, close } = await setup();
  const [item] = await db
    .insert(items)
    .values({ type: "t", title: "gone", deletedAt: ago(31 * DAY) })
    .returning();
  const id = await req({ itemId: item!.id });
  const res = await purgeExpired(deps);
  expect(res.items).toBe(1);
  expect((await get(id))!.itemId).toBeNull();
  await close();
});
