import { operationList } from "@dlh/core";
import { type CoreDeps, writeItems } from "@dlh/server";
import {
  expectAskerScoped,
  freshModuleDb,
  testServer,
} from "@dlh/server/testing";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import tasksServer from "../../tasks/src/server";
import requestsServer from "../src/server";

/** The server's clock for these tests. */
const NOW = new Date("2026-11-02T17:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

async function setup() {
  const t = await freshModuleDb([requestsServer, tasksServer]);
  const { deps, caller } = testServer(t.db, [requestsServer, tasksServer], {
    itemTypes: ["note"],
    now: () => NOW,
  });
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

/** The sender's own Slack requests, read as the Slack service does. */
/** `setup`, and a caller signed in as an agent run, which `fromSender` lets in. */
async function runSetup() {
  const t = await setup();
  const { caller: run } = testServer(t.db, [requestsServer, tasksServer], {
    now: () => NOW,
    principal: { kind: "run", tokenId: "t", runId: "r1" },
  });
  const fileFrom = async (
    handle: string,
    title: string,
    receivedAt: Date,
    extra: Record<string, unknown> = {},
  ) =>
    (
      await t.caller.requests.file({
        title,
        source: "slack",
        sourceHandle: handle,
        receivedAt: receivedAt.toISOString(),
        ...extra,
      })
    ).result.request;
  return { ...t, run, fileFrom };
}

const asker = (slackUserId: string) => ({ slackUserId, githubLogin: null });

test("fromSender returns only that sender's slack requests, newest first", async () => {
  const { run, fileFrom, file, close } = await runSetup();
  const old = await fileFrom("U1", "old", ago(3), {
    externalId: "a",
    body: "b",
  });
  const recent = await fileFrom("U1", "recent", ago(1));
  await fileFrom("U2", "theirs", ago(2));
  await file("manual one");
  const rows = await run.requests.fromSender({ asker: asker("U1") });
  expect(rows.map((r) => r.title)).toEqual(["recent", "old"]);
  expect(rows[1]).toEqual({
    id: old.id,
    title: "old",
    body: "b",
    sourceUrl: null,
    externalId: "a",
    receivedAt: ago(3).toISOString(),
    outcome: null,
    resolvedAt: null,
    appendedIds: [],
  });
  expect(rows[0]?.id).toBe(recent.id);
  await close();
});

test("fromSender returns nothing for another sender", async () => {
  const { run, fileFrom, close } = await runSetup();
  await expectAskerScoped(
    (_, input) =>
      run.requests.fromSender(
        input as Parameters<typeof run.requests.fromSender>[0],
      ),
    "requests.fromSender",
    {},
    (a) => fileFrom(a.slackUserId, "mine", ago(1)),
  );
  await close();
});

test("fromSender openOnly leaves out resolved requests, since leaves out older", async () => {
  const { run, caller, fileFrom, close } = await runSetup();
  const done = await fileFrom("U1", "done", ago(2));
  await fileFrom("U1", "open", ago(1));
  await caller.requests.resolve({
    id: done.id,
    expectedUpdatedAt: done.updatedAt,
    outcome: "handled",
  });
  const all = await run.requests.fromSender({ asker: asker("U1") });
  expect(all.map((r) => r.title)).toEqual(["open", "done"]);
  expect(all[1]?.outcome).toBe("handled");
  const open = await run.requests.fromSender({
    asker: asker("U1"),
    openOnly: true,
  });
  expect(open.map((r) => r.title)).toEqual(["open"]);
  const since = await run.requests.fromSender({
    asker: asker("U1"),
    since: ago(1.5).toISOString(),
  });
  expect(since.map((r) => r.title)).toEqual(["open"]);
  await close();
});
