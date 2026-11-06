import type { CoreDeps } from "@dlh/server";
import { freshModuleDb, testServer } from "@dlh/server/testing";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import tasksServer from "../../tasks/src/server";
import { requests } from "../src/db/schema";
import requestsServer from "../src/server";

async function setup() {
  const t = await freshModuleDb([requestsServer, tasksServer]);
  const { deps, caller } = testServer(t.db, [requestsServer, tasksServer]);
  const file = async (title: string, extra: Record<string, unknown> = {}) =>
    (await caller.requests.file({ title, ...extra })).result.request;
  return { ...t, deps, caller, file };
}

async function row(deps: CoreDeps, id: string) {
  const [r] = await deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, id));
  if (!r) throw new Error("no row");
  return r;
}

async function version(deps: CoreDeps, id: string): Promise<string> {
  const rows = await deps.db.execute<{ v: string }>(
    sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v from items where id = ${id}`,
  );
  return rows[0]?.v ?? "";
}

test("append adds the text after a blank line and records the key", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ask", { body: "First" });
  deps.setNow(new Date(deps.now().getTime() + 1000));
  const out = await caller.requests.append({
    id: r.id,
    key: "C1:2",
    text: "Second",
  });
  expect(out.result).toEqual({ appended: true });
  const after = await row(deps, r.id);
  expect(after.body).toBe("First\n\nSecond");
  expect(after.appendedIds).toEqual(["C1:2"]);
  expect(await version(deps, r.id)).not.toBe(r.updatedAt);
  await close();
});

test("append with a key already present changes nothing", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ask", { body: "First" });
  await caller.requests.append({ id: r.id, key: "k", text: "Second" });
  const v = await version(deps, r.id);
  deps.setNow(new Date(deps.now().getTime() + 1000));
  const again = await caller.requests.append({
    id: r.id,
    key: "k",
    text: "Second",
  });
  expect(again.result).toEqual({ appended: false });
  expect((await row(deps, r.id)).body).toBe("First\n\nSecond");
  expect(await version(deps, r.id)).toBe(v);
  await close();
});

test("append refuses a resolved request", async () => {
  const { caller, file, close } = await setup();
  const r = await file("Ask", { body: "First" });
  await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    outcome: "handled",
  });
  await expect(
    caller.requests.append({ id: r.id, key: "k", text: "More" }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Already resolved" });
  await close();
});

test("undo of append restores the body", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ask", { body: "First" });
  deps.setNow(new Date(deps.now().getTime() + 1000));
  const out = await caller.requests.append({
    id: r.id,
    key: "k",
    text: "More",
  });
  deps.setNow(new Date(deps.now().getTime() + 1000));
  await caller.ops.undo({ id: "requests.append", token: out.undo });
  const after = await row(deps, r.id);
  expect(after.body).toBe("First");
  expect(after.appendedIds).toEqual([]);
  await close();
});
