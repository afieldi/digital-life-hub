import { operationList } from "@dlh/core";
import {
  CORE_ROUTER_IDS,
  type CoreDeps,
  collectServerModules,
  coreRouters,
  operationsRouter,
  router,
  writeItems,
} from "@dlh/server";
import { freshModuleDb, testDeps } from "@dlh/server/testing";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import tasksServer from "../../tasks/src/server";
import requestsServer from "../src/server";

const session = { id: "s", email: "arek@example.com" };
/** The server's clock for these tests. */
const NOW = new Date("2026-11-02T17:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

async function setup() {
  const t = await freshModuleDb([requestsServer, tasksServer]);
  const collected = collectServerModules(
    [requestsServer, tasksServer],
    [...CORE_ROUTER_IDS],
    { actions: [], runners: [] },
  );
  const deps = testDeps(t.db, {
    itemTypes: ["request", "task", "note"],
    now: () => NOW,
    deleteWith: Object.fromEntries(collected.deleteWith),
    operations: collected.operations,
  });
  const app = router({
    ...coreRouters,
    requests: operationsRouter(requestsServer.operations),
    tasks: operationsRouter(tasksServer.operations),
  });
  const caller = app.createCaller({ deps, session });
  const file = async (title: string, receivedAt?: Date) =>
    (
      await caller.requests.file({
        title,
        receivedAt: receivedAt?.toISOString(),
      })
    ).result.request;
  /** Resolves `r` at `at` (the server's clock), then puts the clock back. */
  const resolveAt = async (
    r: { id: string; updatedAt: string },
    outcome: "handled" | "not_for_me",
    at: Date,
  ) => {
    deps.setNow(at);
    const out = (
      await caller.requests.resolve({
        id: r.id,
        expectedUpdatedAt: r.updatedAt,
        outcome,
      })
    ).result;
    deps.setNow(NOW);
    return out;
  };
  return { ...t, deps, caller, file, resolveAt };
}

async function version(deps: CoreDeps, id: string): Promise<string> {
  const rows = await deps.db.execute<{ v: string }>(
    sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v from items where id = ${id}`,
  );
  return rows[0]?.v ?? "";
}

async function setDeleted(deps: CoreDeps, id: string) {
  await writeItems(deps, async (w) =>
    w.setDeleted({
      id,
      expectedUpdatedAt: await version(deps, id),
      deleted: true,
    }),
  );
}

test("open lists oldest received first and hides resolved and deleted", async () => {
  const { caller, deps, file, resolveAt, close } = await setup();
  const newest = await file("newest", ago(1));
  const oldest = await file("oldest", ago(5));
  const middle = await file("middle", ago(3));
  const done = await file("done", ago(4));
  const gone = await file("gone", ago(2));
  await resolveAt(done, "handled", ago(0));
  await setDeleted(deps, gone.id);

  const out = await caller.requests.open({});
  expect(out.heading).toBe("Waiting on you");
  expect(out.items.map((r) => r.id)).toEqual([oldest.id, middle.id, newest.id]);
  await close();
});

test("open hides archived requests", async () => {
  const { caller, file, close } = await setup();
  const kept = await file("kept", ago(2));
  const shelved = await file("shelved", ago(1));
  await caller.items.archive({
    id: shelved.id,
    expectedUpdatedAt: shelved.updatedAt,
  });

  const out = await caller.requests.open({});
  expect(out.items.map((r) => r.id)).toEqual([kept.id]);
  await close();
});

test("open breaks ties by id", async () => {
  const { caller, file, close } = await setup();
  const at = ago(2);
  const ids = [
    (await file("a", at)).id,
    (await file("b", at)).id,
    (await file("c", at)).id,
  ].sort();
  const out = await caller.requests.open({});
  expect(out.items.map((r) => r.id)).toEqual(ids);
  await close();
});

test("open's result parses as operationList", async () => {
  const { caller, file, close } = await setup();
  await file("one");
  const out = await caller.requests.open({});
  expect(operationList.parse(out).items).toHaveLength(1);
  await close();
});

test("resolved pages newest first within 30 days", async () => {
  const { caller, file, resolveAt, close } = await setup();
  const old = await file("old");
  await resolveAt(old, "handled", ago(31));
  const made: string[] = [];
  for (let i = 0; i < 52; i++) {
    const r = await file(`r${i}`);
    // Newest last: r51 resolved most recently.
    await resolveAt(r, "handled", new Date(ago(29).getTime() + i * 60_000));
    made.push(r.id);
  }
  const first = await caller.requests.resolved({});
  expect(first.rows).toHaveLength(50);
  expect(first.rows[0]?.id).toBe(made[51]);
  expect(first.nextCursor).toBeTruthy();
  const second = await caller.requests.resolved({
    cursor: first.nextCursor,
  });
  expect(second.rows.map((r) => r.id)).toEqual([made[1], made[0]]);
  expect(second.nextCursor).toBeUndefined();
  const all = [...first.rows, ...second.rows];
  expect(all.some((r) => r.id === old.id)).toBe(false);
  await close();
});

test("resolved filters by outcome", async () => {
  const { caller, file, resolveAt, close } = await setup();
  const a = await file("a");
  const b = await file("b");
  await resolveAt(a, "handled", ago(2));
  await resolveAt(b, "not_for_me", ago(1));
  const out = await caller.requests.resolved({ outcome: "not_for_me" });
  expect(out.rows.map((r) => r.id)).toEqual([b.id]);
  await close();
});

test("resolved rows carry the task a task outcome made", async () => {
  const { caller, deps, file, resolveAt, close } = await setup();
  const handled = await file("handled");
  await resolveAt(handled, "handled", ago(1));
  const asked = await file("ask");
  const made = (
    await caller.requests.makeTask({
      id: asked.id,
      expectedUpdatedAt: asked.updatedAt,
      title: "Follow up",
    })
  ).result;
  const byId = async () =>
    Object.fromEntries(
      (await caller.requests.resolved({})).rows.map((r) => [r.id, r.task]),
    );
  expect(await byId()).toEqual({
    [handled.id]: null,
    [asked.id]: { id: made.task.id, title: "Follow up", deleted: false },
  });
  await setDeleted(deps, made.task.id);
  expect((await byId())[asked.id]).toEqual({
    id: made.task.id,
    title: "Follow up",
    deleted: true,
  });
  await close();
});

test("get returns the outcome task, even after it is deleted", async () => {
  const { caller, deps, file, close } = await setup();
  const r = await file("ask");
  const made = (
    await caller.requests.makeTask({
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
    })
  ).result;
  const got = await caller.requests.get({ id: r.id });
  expect(got.request.id).toBe(r.id);
  expect(got.request.outcome).toBe("task");
  expect(got.task).toEqual({
    id: made.task.id,
    title: "ask",
    deleted: false,
  });

  await setDeleted(deps, made.task.id);
  const after = await caller.requests.get({ id: r.id });
  expect(after.task).toEqual({
    id: made.task.id,
    title: "ask",
    deleted: true,
  });
  await close();
});

test("get has no task for an open request", async () => {
  const { caller, file, close } = await setup();
  const r = await file("ask");
  expect((await caller.requests.get({ id: r.id })).task).toBeNull();
  await close();
});

test("get on a deleted request is NOT_FOUND", async () => {
  const { caller, deps, file, close } = await setup();
  const r = await file("ask");
  await setDeleted(deps, r.id);
  await expect(caller.requests.get({ id: r.id })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  await close();
});
