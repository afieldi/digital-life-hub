import { describeOperation } from "@dlh/core";
import {
  CORE_ROUTER_IDS,
  type CoreDeps,
  collectServerModules,
  coreRouters,
  defineServerModule,
  implementOperation,
  operationsRouter,
  router,
  writeItems,
} from "@dlh/server";
import {
  expectModuleWrites,
  expectTracked,
  freshModuleDb,
  testDeps,
} from "@dlh/server/testing";
import { asc, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { z } from "zod";
import tasksServer from "../../tasks/src/server";
import { requests } from "../src/db/schema";
import { requestOps } from "../src/operations";
import requestsServer from "../src/server";
import { seed } from "../src/server/seed";

const session = { id: "s", email: "arek@example.com" };

/** A module whose `approve` resolves a request through an operation call, as agent approvals will. */
const approveDesc = describeOperation({
  id: "fake.approve",
  kind: "mutation",
  label: "Approve",
  description: "Approves and resolves the request.",
  appliesTo: "none",
  input: z.object({ id: z.uuid(), expectedUpdatedAt: z.iso.datetime() }),
  subject: () => null,
  effects: [],
  summary: () => "Approve",
  calls: [requestOps.resolve],
});
const plainDesc = describeOperation({
  id: "fake.plain",
  kind: "mutation",
  label: "Plain",
  description: "Calls nothing.",
  appliesTo: "none",
  input: z.object({}),
  subject: () => null,
  effects: [],
  summary: () => "Plain",
});
const peekDesc = describeOperation({
  id: "fake.peek",
  kind: "query",
  label: "Peek",
  description: "A query.",
  appliesTo: "none",
  input: z.object({}),
  subject: () => null,
  effects: [],
  summary: () => "Peek",
});
const noop = {
  async run() {
    return { result: null, undo: null };
  },
  async undo() {},
  undoRecord: z.null(),
};
const fakeServer = defineServerModule({
  id: "fake",
  itemTypes: [],
  operations: {
    approve: implementOperation(approveDesc, noop),
    plain: implementOperation(plainDesc, noop),
    peek: implementOperation(peekDesc, {
      async run() {
        return null;
      },
    }),
  },
});

async function setup() {
  const t = await freshModuleDb([requestsServer, tasksServer]);
  const collected = collectServerModules(
    [requestsServer, tasksServer, fakeServer],
    [...CORE_ROUTER_IDS],
    { actions: [], runners: [] },
  );
  const deps = testDeps(t.db, {
    itemTypes: ["request", "task", "note"],
    deleteWith: Object.fromEntries(collected.deleteWith),
    operations: collected.operations,
  });
  const app = router({
    ...coreRouters,
    requests: operationsRouter(requestsServer.operations),
    tasks: operationsRouter(tasksServer.operations),
  });
  const caller = app.createCaller({ deps, session });
  const file = async (title: string, extra: Record<string, unknown> = {}) =>
    (await caller.requests.file({ title, ...extra })).result.request;
  const mkTask = async (title: string) =>
    (await caller.tasks.create({ title })).result;
  return { ...t, deps, caller, file, mkTask };
}

/** The item's current version, as the API sends it. */
async function version(deps: CoreDeps, id: string): Promise<string> {
  const rows = await deps.db.execute<{ v: string }>(
    sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v from items where id = ${id}`,
  );
  return rows[0]?.v ?? "";
}

async function itemRow(deps: CoreDeps, id: string) {
  const rows = await deps.db.execute<{
    title: string;
    search_text: string | null;
    deleted: boolean;
  }>(sql`
    select title, search_text, deleted_at is not null as deleted
    from items where id = ${id}`);
  const row = rows[0];
  if (!row) throw new Error(`no item ${id}`);
  return row;
}

async function requestRow(deps: CoreDeps, id: string) {
  const [row] = await deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, id));
  if (!row) throw new Error(`no request row ${id}`);
  return row;
}

type LinkRow = { id: string; to_id: string; context: string | null };

async function relatesFrom(deps: CoreDeps, id: string): Promise<LinkRow[]> {
  const rows = await deps.db.execute<LinkRow>(sql`
    select id, to_id, context from links
    where from_id = ${id} and kind = 'relates' order by created_at, id`);
  return [...rows];
}

async function count(deps: CoreDeps, table: "items" | "requests" | "links") {
  const rows = await deps.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return rows[0]?.n ?? 0;
}

async function setDeleted(deps: CoreDeps, id: string, deleted: boolean) {
  await writeItems(deps, async (w) =>
    w.setDeleted({ id, expectedUpdatedAt: await version(deps, id), deleted }),
  );
}

/**
 * Everything a request write can change, without versions: live items, their
 * request rows and links between live items.
 */
async function snapshot(deps: CoreDeps) {
  const live = await deps.db.execute(sql`
    select id, type, title, search_text from items where deleted_at is null order by id`);
  const rows = await deps.db
    .select({
      itemId: requests.itemId,
      outcome: requests.outcome,
      resolvedAt: requests.resolvedAt,
    })
    .from(requests)
    .where(
      sql`exists (select 1 from items i where i.id = ${requests.itemId} and i.deleted_at is null)`,
    )
    .orderBy(asc(requests.itemId));
  const links = await deps.db.execute(sql`
    select from_id, to_id, kind, context from links l
    where exists (select 1 from items i where i.id = l.from_id and i.deleted_at is null)
      and exists (select 1 from items i where i.id = l.to_id and i.deleted_at is null)
    order by from_id, to_id`);
  return { live: [...live], rows, links: [...links] };
}

test("file writes item and row in one transaction", async () => {
  const { deps, caller, close } = await setup();
  const out = await caller.requests.file({
    title: "Review the Q3 deck",
    body: "Can you look at slides 4-9?",
    fromName: "Maya",
    source: "slack",
    sourceHandle: "U123",
    sourceUrl: "https://example.slack.com/archives/C1/p1",
    externalId: "C1:1",
    receivedAt: "2026-10-29T09:00:00.000Z",
  });
  const { request, existing } = out.result;
  expect(existing).toBe(false);
  expect(out.undo.created).toEqual([request.id]);
  expect(request).toMatchObject({
    type: "request",
    title: "Review the Q3 deck",
    body: "Can you look at slides 4-9?",
    fromName: "Maya",
    source: "slack",
    externalId: "C1:1",
    receivedAt: "2026-10-29T09:00:00.000Z",
    resolvedAt: null,
    outcome: null,
    actions: null,
  });
  expect(await itemRow(deps, request.id)).toMatchObject({
    title: "Review the Q3 deck",
    search_text: "Can you look at slides 4-9?\nMaya",
  });
  expect(await requestRow(deps, request.id)).toMatchObject({
    source: "slack",
    sourceHandle: "U123",
    receivedAt: new Date("2026-10-29T09:00:00.000Z"),
  });

  // No source is an AI filing; received_at defaults to now; no text, no search_text.
  const plain = (await caller.requests.file({ title: "Look at later" })).result
    .request;
  expect(plain.source).toBe("ai");
  expect(plain.receivedAt).toBe(deps.now().toISOString());
  expect((await itemRow(deps, plain.id)).search_text).toBeNull();

  // A failure after the item is written leaves neither item nor row.
  const before = [await count(deps, "items"), await count(deps, "requests")];
  await expect(
    caller.requests.file({
      title: "Bad action",
      actions: [{ label: "Go", operation: "fake.plain", input: {} }],
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect([await count(deps, "items"), await count(deps, "requests")]).toEqual(
    before,
  );
  await close();
});

test("file twice with one (source, externalId) gives one request", async () => {
  const { deps, caller, close } = await setup();
  const input = { title: "Ping", source: "slack" as const, externalId: "X" };
  const first = await caller.requests.file(input);
  const second = await caller.requests.file({ ...input, title: "Other" });
  expect(second.result.existing).toBe(true);
  expect(second.result.request).toEqual(first.result.request);
  expect(second.undo).toEqual({ record: null, created: [] });
  expect(await count(deps, "requests")).toBe(1);
  // The same id under another source is another request.
  const agent = await caller.requests.file({ ...input, source: "agent" });
  expect(agent.result.existing).toBe(false);
  expect(await count(deps, "requests")).toBe(2);
  await close();
});

test("concurrent files with one pair give one row", async () => {
  const { deps, caller, close } = await setup();
  const input = { title: "Ping", source: "slack" as const, externalId: "Y" };
  const [a, b] = await Promise.all([
    caller.requests.file(input),
    caller.requests.file(input),
  ]);
  expect(a.result.request.id).toBe(b.result.request.id);
  expect([a.result.existing, b.result.existing].sort()).toEqual([false, true]);
  expect(await count(deps, "requests")).toBe(1);
  await close();
});

test("file after delete returns the deleted request and writes nothing", async () => {
  const { deps, caller, file, close } = await setup();
  const input = { source: "slack" as const, externalId: "Z" };
  const r = await file("Ping", input);
  await setDeleted(deps, r.id, true);
  const items = await count(deps, "items");
  const v = await version(deps, r.id);
  const again = await caller.requests.file({ title: "Ping", ...input });
  expect(again.result).toMatchObject({
    existing: true,
    request: { id: r.id },
  });
  expect(again.undo).toEqual({ record: null, created: [] });
  expect(await count(deps, "items")).toBe(items);
  expect(await version(deps, r.id)).toBe(v);
  expect((await itemRow(deps, r.id)).deleted).toBe(true);
  await close();
});

test("file refuses an action whose operation doesn't call requests.resolve", async () => {
  const { caller, close } = await setup();
  for (const operation of ["fake.plain", "fake.peek", "fake.missing"]) {
    await expect(
      caller.requests.file({
        title: "Approve?",
        actions: [{ label: "Go", operation, input: {} }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  const ok = await caller.requests.file({
    title: "Approve?",
    source: "agent",
    actions: [{ label: "Approve", operation: "fake.approve", input: {} }],
  });
  expect(ok.result.request.actions).toEqual([
    { label: "Approve", operation: "fake.approve", input: {} },
  ]);
  await close();
});

test("resolve handled sets outcome and resolved_at together", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  const out = await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    outcome: "handled",
  });
  expect(out.result).toMatchObject({
    id: r.id,
    outcome: "handled",
    resolvedAt: deps.now().toISOString(),
  });
  expect(out.result.updatedAt > r.updatedAt).toBe(true);
  expect(await requestRow(deps, r.id)).toMatchObject({
    outcome: "handled",
    resolvedAt: deps.now(),
  });
  expect(await relatesFrom(deps, r.id)).toEqual([]);
  await close();
});

test("resolve task links an existing task with context outcome", async () => {
  const { deps, caller, file, mkTask, close } = await setup();
  const r = await file("Ping");
  const task = await mkTask("Do the thing");
  const out = await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    outcome: "task",
    taskId: task.id,
  });
  expect(out.result.outcome).toBe("task");
  expect(await relatesFrom(deps, r.id)).toMatchObject([
    { to_id: task.id, context: "outcome" },
  ]);
  await close();
});

test("resolve task refuses a deleted task or a note", async () => {
  const { deps, caller, file, mkTask, close } = await setup();
  const r = await file("Ping");
  const gone = await mkTask("Gone");
  await setDeleted(deps, gone.id, true);
  const note = await writeItems(deps, (w) =>
    w.createItem({ type: "note", title: "A note" }),
  );
  const target = { id: r.id, expectedUpdatedAt: r.updatedAt };
  await expect(
    caller.requests.resolve({ ...target, outcome: "task", taskId: gone.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(
    caller.requests.resolve({ ...target, outcome: "task", taskId: note.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await requestRow(deps, r.id)).toMatchObject({ outcome: null });
  expect(await relatesFrom(deps, r.id)).toEqual([]);
  await close();
});

test("resolve twice with a stale version is a no-op", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  const target = { id: r.id, expectedUpdatedAt: r.updatedAt };
  const first = await caller.requests.resolve({
    ...target,
    outcome: "handled",
  });
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  const second = await caller.requests.resolve({
    ...target,
    outcome: "handled",
  });
  expect(second.result).toEqual(first.result);
  expect(second.undo).toEqual({ record: null, created: [] });
  expect((await requestRow(deps, r.id)).resolvedAt).toEqual(
    new Date("2026-10-30T12:00:00.000Z"),
  );

  // Two devices pressing Handled at once: both succeed, one writes. Several
  // pairs at once, so the two of a pair overlap.
  const pairs = await Promise.all(
    Array.from({ length: 8 }, async (_, i) => {
      const s = await file(`Pong ${i}`);
      const v = { id: s.id, expectedUpdatedAt: s.updatedAt };
      return Promise.all([
        caller.requests.resolve({ ...v, outcome: "handled" }),
        caller.requests.resolve({ ...v, outcome: "handled" }),
      ]);
    }),
  );
  for (const [one, two] of pairs) {
    expect(one.result.updatedAt).toBe(two.result.updatedAt);
  }
  await close();
});

test("resolve with another outcome is CONFLICT", async () => {
  const { deps, caller, file, mkTask, close } = await setup();
  const r = await file("Ping");
  const done = await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    outcome: "handled",
  });
  const target = { id: r.id, expectedUpdatedAt: done.result.updatedAt };
  await expect(
    caller.requests.resolve({ ...target, outcome: "not_for_me" }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Already resolved" });
  const task = await mkTask("T");
  await expect(
    caller.requests.resolve({ ...target, outcome: "task", taskId: task.id }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await requestRow(deps, r.id)).outcome).toBe("handled");
  await close();
});

test("resolve task with another taskId on a task-resolved request is CONFLICT", async () => {
  const { deps, caller, file, mkTask, close } = await setup();
  const r = await file("Ping");
  const task = await mkTask("First");
  const other = await mkTask("Second");
  const done = await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    outcome: "task",
    taskId: task.id,
  });
  const target = { id: r.id, expectedUpdatedAt: done.result.updatedAt };
  await expect(
    caller.requests.resolve({ ...target, outcome: "task", taskId: other.id }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  // The same task again is a no-op.
  const again = await caller.requests.resolve({
    ...target,
    outcome: "task",
    taskId: task.id,
  });
  expect(again.undo).toEqual({ record: null, created: [] });
  expect(await relatesFrom(deps, r.id)).toMatchObject([
    { to_id: task.id, context: "outcome" },
  ]);
  await close();
});

test("makeTask creates the task through tasks.create", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Review the deck", { body: "Slides 4-9" });
  const out = await caller.requests.makeTask({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  const { request, task } = out.result;
  // Title and notes default from the request.
  expect(task).toMatchObject({ type: "task", title: "Review the deck" });
  expect(await itemRow(deps, task.id)).toMatchObject({
    search_text: "Slides 4-9",
  });
  const [taskRow] = await deps.db.execute<{
    notes: string | null;
    priority: string;
  }>(sql`select notes, priority from tasks where item_id = ${task.id}`);
  expect(taskRow).toEqual({ notes: "Slides 4-9", priority: "medium" });
  expect(request).toMatchObject({ outcome: "task" });
  expect(await relatesFrom(deps, r.id)).toMatchObject([
    { to_id: task.id, context: "outcome" },
  ]);
  expect(out.undo.created).toEqual([task.id]);

  // What the form changed wins over the request.
  const s = await file("Call Sam", { body: "About the lease" });
  const custom = await caller.requests.makeTask({
    id: s.id,
    expectedUpdatedAt: s.updatedAt,
    title: "Call Sam about the lease",
    due: { date: "2026-11-06" },
    priority: "high",
    notes: "Ask about parking",
  });
  const [row] = await deps.db.execute<{
    due_date: string;
    priority: string;
    notes: string;
  }>(
    sql`select due_date::text, priority, notes from tasks where item_id = ${custom.result.task.id}`,
  );
  expect(custom.result.task.title).toBe("Call Sam about the lease");
  // The task's title is the task's: the request keeps its own.
  expect(custom.result.request.title).toBe("Call Sam");
  expect(await itemRow(deps, s.id)).toMatchObject({ title: "Call Sam" });
  expect(row).toEqual({
    due_date: "2026-11-06",
    priority: "high",
    notes: "Ask about parking",
  });
  await close();
});

test('makeTask with notes "" makes a task with no notes', async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Review the deck", { body: "Slides 4-9" });
  const out = await caller.requests.makeTask({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    notes: "",
  });
  const [taskRow] = await deps.db.execute<{ notes: string | null }>(
    sql`select notes from tasks where item_id = ${out.result.task.id}`,
  );
  expect(taskRow).toEqual({ notes: null });
  expect(await itemRow(deps, out.result.task.id)).toMatchObject({
    search_text: null,
  });
  await close();
});

test("makeTask with an invalid due is refused and leaves no task", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  const items = await count(deps, "items");
  await expect(
    caller.requests.makeTask({
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
      due: { dateTime: "2026-11-06T09:00:00Z", timeZone: "Mars/Olympus" },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await count(deps, "items")).toBe(items);
  expect(await requestRow(deps, r.id)).toMatchObject({ outcome: null });
  expect(await version(deps, r.id)).toBe(r.updatedAt);
  await close();
});

test("makeTask on a resolved request is CONFLICT", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  const done = await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    outcome: "handled",
  });
  const items = await count(deps, "items");
  await expect(
    caller.requests.makeTask({
      id: r.id,
      expectedUpdatedAt: done.result.updatedAt,
    }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Already resolved" });
  expect(await count(deps, "items")).toBe(items);
  await close();
});

test("makeTask undo after the task was edited still removes it", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  const out = await caller.requests.makeTask({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  const { task } = out.result;
  await caller.tasks.update({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
    title: "Edited",
  });
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  await caller.ops.undo({ id: "requests.makeTask", token: out.undo });
  expect((await itemRow(deps, task.id)).deleted).toBe(true);
  expect(await requestRow(deps, r.id)).toMatchObject({
    outcome: null,
    resolvedAt: null,
  });
  expect(await relatesFrom(deps, r.id)).toEqual([]);

  // If the request changed since, nothing reverts.
  const s = await file("Pong");
  const again = await caller.requests.makeTask({
    id: s.id,
    expectedUpdatedAt: s.updatedAt,
  });
  await caller.requests.reopen({
    id: s.id,
    expectedUpdatedAt: again.result.request.updatedAt,
  });
  await expect(
    caller.ops.undo({ id: "requests.makeTask", token: again.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  expect((await itemRow(deps, again.result.task.id)).deleted).toBe(false);
  await close();
});

test("reopen on an open request is CONFLICT Not resolved and writes nothing", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  await expect(
    caller.requests.reopen({ id: r.id, expectedUpdatedAt: r.updatedAt }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Not resolved" });
  expect(await requestRow(deps, r.id)).toMatchObject({ outcome: null });
  expect(await version(deps, r.id)).toBe(r.updatedAt);
  await close();
});

test("reopen removes only the outcome link and keeps the task", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  const made = await caller.requests.makeTask({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  const out = await caller.requests.reopen({
    id: r.id,
    expectedUpdatedAt: made.result.request.updatedAt,
  });
  expect(out.result).toMatchObject({ outcome: null, resolvedAt: null });
  expect(await requestRow(deps, r.id)).toMatchObject({
    outcome: null,
    resolvedAt: null,
  });
  expect(await relatesFrom(deps, r.id)).toEqual([]);
  expect((await itemRow(deps, made.result.task.id)).deleted).toBe(false);
  expect(out.undo.record).toMatchObject({
    outcome: "task",
    taskId: made.result.task.id,
  });
  await close();
});

test("reopen keeps a link the person added", async () => {
  const { deps, caller, file, mkTask, close } = await setup();
  const r = await file("Ping");
  const task = await mkTask("Mine");
  // Linked by hand first; resolve's addLink returns that link unchanged.
  await caller.links.add({ fromId: r.id, toId: task.id, kind: "relates" });
  const done = await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: await version(deps, r.id),
    outcome: "task",
    taskId: task.id,
  });
  expect(await relatesFrom(deps, r.id)).toMatchObject([
    { to_id: task.id, context: null },
  ]);
  await caller.requests.reopen({
    id: r.id,
    expectedUpdatedAt: done.result.updatedAt,
  });
  expect(await relatesFrom(deps, r.id)).toMatchObject([
    { to_id: task.id, context: null },
  ]);

  // A hand link to another task stays when the outcome link goes.
  const other = await mkTask("Other");
  await caller.links.add({ fromId: r.id, toId: other.id, kind: "relates" });
  const made = await caller.requests.makeTask({
    id: r.id,
    expectedUpdatedAt: await version(deps, r.id),
  });
  expect(await relatesFrom(deps, r.id)).toHaveLength(3);
  await caller.requests.reopen({
    id: r.id,
    expectedUpdatedAt: made.result.request.updatedAt,
  });
  expect((await relatesFrom(deps, r.id)).map((l) => l.to_id).sort()).toEqual(
    [task.id, other.id].sort(),
  );
  await close();
});

test("reopen finds a hand-linked task and its undo resolves with it again", async () => {
  const { deps, caller, file, mkTask, close } = await setup();
  const r = await file("Ping");
  const task = await mkTask("Mine");
  await caller.links.add({ fromId: r.id, toId: task.id, kind: "relates" });
  const done = await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: await version(deps, r.id),
    outcome: "task",
    taskId: task.id,
  });
  const reopened = await caller.requests.reopen({
    id: r.id,
    expectedUpdatedAt: done.result.updatedAt,
  });
  expect(await relatesFrom(deps, r.id)).toMatchObject([
    { to_id: task.id, context: null },
  ]);
  expect(reopened.undo.record).toMatchObject({
    outcome: "task",
    taskId: task.id,
    resolvedAt: done.result.resolvedAt,
  });
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  await caller.ops.undo({ id: "requests.reopen", token: reopened.undo });
  expect(await requestRow(deps, r.id)).toMatchObject({
    outcome: "task",
    resolvedAt: new Date(done.result.resolvedAt ?? ""),
  });
  expect(await relatesFrom(deps, r.id)).toMatchObject([
    { to_id: task.id, context: null },
  ]);
  await close();
});

test("deleting the task leaves the request resolved", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  const made = await caller.requests.makeTask({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
  });
  await setDeleted(deps, made.result.task.id, true);
  expect((await itemRow(deps, r.id)).deleted).toBe(false);
  expect(await requestRow(deps, r.id)).toMatchObject({ outcome: "task" });
  expect(await version(deps, r.id)).toBe(made.result.request.updatedAt);
  // Reopen still removes the outcome link to the deleted task.
  await caller.requests.reopen({
    id: r.id,
    expectedUpdatedAt: made.result.request.updatedAt,
  });
  expect(await relatesFrom(deps, r.id)).toEqual([]);
  await close();
});

test("each mutation of a request moves updated_at and publishes it", async () => {
  const { deps, caller, file, mkTask, close } = await setup();
  const r = await file("Ping");
  const v = (id: string) => version(deps, id);
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.requests.resolve({
        id,
        expectedUpdatedAt: await v(id),
        outcome: "not_for_me",
      }),
    r.id,
  );
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.requests.reopen({ id, expectedUpdatedAt: await v(id) }),
    r.id,
  );
  const task = await mkTask("T");
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.requests.resolve({
        id,
        expectedUpdatedAt: await v(id),
        outcome: "task",
        taskId: task.id,
      }),
    r.id,
  );
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.requests.reopen({ id, expectedUpdatedAt: await v(id) }),
    r.id,
  );
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.requests.makeTask({ id, expectedUpdatedAt: await v(id) }),
    r.id,
  );
  // Filing changes no existing row, so it only publishes.
  await expectTracked(deps, {}, () => file("New"));
  await close();
});

/**
 * Whether the request's item row is locked by another transaction while `run`
 * waits behind a lock this test holds on its `requests` row, as a forward
 * write would.
 */
async function locksItemFirst(
  deps: CoreDeps,
  id: string,
  run: () => Promise<unknown>,
): Promise<boolean> {
  let pending: Promise<unknown> = Promise.resolve();
  let itemLocked = false;
  await deps.db.transaction(async (tx) => {
    await tx
      .select()
      .from(requests)
      .where(eq(requests.itemId, id))
      .for("update");
    pending = run().catch(() => {});
    await new Promise((r) => setTimeout(r, 300));
    try {
      await deps.db.transaction((probe) =>
        probe.execute(
          sql`select 1 from items where id = ${id} for update nowait`,
        ),
      );
    } catch {
      itemLocked = true;
    }
  });
  await pending;
  return itemLocked;
}

test("undo locks the request row before its item, as forward writes do", async () => {
  const { deps, caller, file, close } = await setup();
  const r = await file("Ping");
  const done = await caller.requests.resolve({
    id: r.id,
    expectedUpdatedAt: r.updatedAt,
    outcome: "handled",
  });
  expect(
    await locksItemFirst(deps, r.id, () =>
      caller.ops.undo({ id: "requests.resolve", token: done.undo }),
    ),
  ).toBe(false);
  expect((await requestRow(deps, r.id)).outcome).toBeNull();

  const s = await file("Pong");
  const made = await caller.requests.makeTask({
    id: s.id,
    expectedUpdatedAt: s.updatedAt,
  });
  expect(
    await locksItemFirst(deps, s.id, () =>
      caller.ops.undo({ id: "requests.makeTask", token: made.undo }),
    ),
  ).toBe(false);
  expect((await requestRow(deps, s.id)).outcome).toBeNull();

  const t = await file("Pang");
  const resolved = await caller.requests.resolve({
    id: t.id,
    expectedUpdatedAt: t.updatedAt,
    outcome: "not_for_me",
  });
  const reopened = await caller.requests.reopen({
    id: t.id,
    expectedUpdatedAt: resolved.result.updatedAt,
  });
  expect(
    await locksItemFirst(deps, t.id, () =>
      caller.ops.undo({ id: "requests.reopen", token: reopened.undo }),
    ),
  ).toBe(false);
  expect((await requestRow(deps, t.id)).outcome).toBe("not_for_me");
  await close();
});

test("each mutation's undo restores the prior state", async () => {
  const { deps, caller, file, mkTask, close } = await setup();
  type Ids = { open: string; handled: string; made: string; task: string };
  type Case = {
    op: string;
    run: (
      ids: Ids,
    ) => Promise<{ undo: { record?: unknown; created: string[] } }>;
  };
  const v = (id: string) => version(deps, id);
  const cases: Case[] = [
    {
      op: "file",
      run: () =>
        caller.requests.file({
          title: "New",
          body: "Details",
          fromName: "Maya",
          source: "slack",
          externalId: "U1",
        }),
    },
    {
      op: "resolve",
      run: async ({ open }) =>
        caller.requests.resolve({
          id: open,
          expectedUpdatedAt: await v(open),
          outcome: "not_for_me",
        }),
    },
    {
      op: "resolve",
      run: async ({ open, task }) =>
        caller.requests.resolve({
          id: open,
          expectedUpdatedAt: await v(open),
          outcome: "task",
          taskId: task,
        }),
    },
    {
      op: "makeTask",
      run: async ({ open }) =>
        caller.requests.makeTask({
          id: open,
          expectedUpdatedAt: await v(open),
          priority: "high",
        }),
    },
    {
      op: "reopen",
      run: async ({ handled }) =>
        caller.requests.reopen({
          id: handled,
          expectedUpdatedAt: await v(handled),
        }),
    },
    {
      op: "reopen",
      run: async ({ made }) =>
        caller.requests.reopen({ id: made, expectedUpdatedAt: await v(made) }),
    },
  ];
  const open = await file("Open");
  const handled = await file("Handled");
  await caller.requests.resolve({
    id: handled.id,
    expectedUpdatedAt: handled.updatedAt,
    outcome: "handled",
  });
  const made = await file("Made");
  await caller.requests.makeTask({
    id: made.id,
    expectedUpdatedAt: made.updatedAt,
  });
  const task = await mkTask("Existing");
  const ids = {
    open: open.id,
    handled: handled.id,
    made: made.id,
    task: task.id,
  };

  const ops = new Set<string>();
  for (const c of cases) {
    const before = await snapshot(deps);
    const out = await c.run(ids);
    expect(await snapshot(deps), c.op).not.toEqual(before);
    deps.setNow(new Date(deps.now().getTime() + 1000));
    await caller.ops.undo({ id: `requests.${c.op}`, token: out.undo });
    expect(await snapshot(deps), c.op).toEqual(before);
    ops.add(c.op);
  }
  const mutations = Object.entries(requestsServer.operations)
    .filter(([, op]) => op.kind === "mutation")
    .map(([key]) => key);
  expect([...ops].sort()).toEqual(mutations.sort());
  await close();
});

test("seed writes open, handled and not-for-me requests", async () => {
  const { deps, close } = await setup();
  await writeItems(deps, (w) => seed(w));
  const rows = await deps.db.select().from(requests);
  const open = rows.filter((r) => r.outcome === null);
  expect(open).toHaveLength(3);
  expect(open.filter((r) => r.source === "manual")).toHaveLength(1);
  const slack = open.filter((r) => r.source === "slack");
  expect(slack).toHaveLength(2);
  for (const r of slack) {
    expect(r.fromName).not.toBeNull();
    expect(r.sourceUrl).not.toBeNull();
    expect(r.externalId).not.toBeNull();
  }
  expect(rows.map((r) => r.outcome).sort()).toEqual(
    expect.arrayContaining(["handled", "not_for_me"]),
  );
  await close();
});
