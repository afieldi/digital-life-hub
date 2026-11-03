import { type CoreDeps, writeItems } from "@dlh/server";
import {
  expectModuleWrites,
  expectTracked,
  freshModuleDb,
  testServer,
} from "@dlh/server/testing";
import { asc, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { tasks } from "../src/db/schema";
import tasksServer from "../src/server";
import { seed } from "../src/server/seed";

async function setup() {
  const t = await freshModuleDb([tasksServer]);
  const { deps, caller } = testServer(t.db, [tasksServer], {
    itemTypes: ["note"],
  });
  const mk = async (title: string, extra: { parentId?: string } = {}) =>
    (await caller.tasks.create({ title, ...extra })).result;
  return { ...t, deps, caller, mk };
}

type ItemRow = {
  id: string;
  title: string;
  search_text: string | null;
  updated_at: string;
  deleted: boolean;
};

async function itemRow(deps: CoreDeps, id: string): Promise<ItemRow> {
  const rows = await deps.db.execute<ItemRow>(sql`
    select id, title, search_text, updated_at::text as updated_at, deleted_at is not null as deleted
    from items where id = ${id}`);
  const row = rows[0];
  if (!row) throw new Error(`no item ${id}`);
  return row;
}

/** The item's current version, as the API sends it. */
async function version(deps: CoreDeps, id: string): Promise<string> {
  const rows = await deps.db.execute<{ v: string }>(
    sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v from items where id = ${id}`,
  );
  return rows[0]?.v ?? "";
}

async function taskRow(deps: CoreDeps, id: string) {
  const [row] = await deps.db.select().from(tasks).where(eq(tasks.itemId, id));
  if (!row) throw new Error(`no task row ${id}`);
  return row;
}

async function childrenOf(deps: CoreDeps, id: string): Promise<string[]> {
  const rows = await deps.db.execute<{ to_id: string }>(
    sql`select to_id from links where from_id = ${id} and kind = 'contains' order by created_at`,
  );
  return rows.map((r) => r.to_id);
}

async function count(deps: CoreDeps, table: "items" | "tasks" | "links") {
  const rows = await deps.db.execute<{ n: number }>(
    sql`select count(*)::int as n from ${sql.identifier(table)}`,
  );
  return rows[0]?.n ?? 0;
}

async function setDeleted(deps: CoreDeps, id: string, deleted: boolean) {
  await writeItems(deps, async (w) =>
    w.setDeleted({
      id,
      expectedUpdatedAt: await version(deps, id),
      deleted,
    }),
  );
}

/** Everything a task write can change, without versions: live items, their rows and links. */
async function snapshot(deps: CoreDeps) {
  const live = await deps.db.execute(sql`
    select id, title, search_text from items where deleted_at is null order by id`);
  const rows = await deps.db
    .select()
    .from(tasks)
    .where(
      sql`exists (select 1 from items i where i.id = ${tasks.itemId} and i.deleted_at is null)`,
    )
    .orderBy(asc(tasks.itemId));
  const links = await deps.db.execute(sql`
    select from_id, to_id, kind from links l
    where exists (select 1 from items i where i.id = l.from_id and i.deleted_at is null)
      and exists (select 1 from items i where i.id = l.to_id and i.deleted_at is null)
    order by from_id, to_id`);
  return { live: [...live], rows, links: [...links] };
}

test("create writes item and row in one transaction", async () => {
  const { deps, caller, mk, close } = await setup();
  const { result } = await caller.tasks.create({
    title: "Call the bank",
    due: {
      dateTime: "2026-11-06T09:00:00-08:00",
      timeZone: "America/Los_Angeles",
    },
    priority: "high",
    notes: "Ask about the fee",
  });
  expect(result.type).toBe("task");
  expect(await itemRow(deps, result.id)).toMatchObject({
    title: "Call the bank",
    search_text: "Ask about the fee",
  });
  expect(await taskRow(deps, result.id)).toMatchObject({
    completedAt: null,
    dueDate: null,
    dueAt: new Date("2026-11-06T17:00:00.000Z"),
    dueTz: "America/Los_Angeles",
    priority: "high",
    notes: "Ask about the fee",
  });

  // A failing link rolls back both the item and its row.
  const gone = await mk("Gone");
  await setDeleted(deps, gone.id, true);
  const [items, rows] = [
    await count(deps, "items"),
    await count(deps, "tasks"),
  ];
  await expect(
    caller.tasks.create({ title: "Orphan", parentId: gone.id }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await count(deps, "items")).toBe(items);
  expect(await count(deps, "tasks")).toBe(rows);
  await close();
});

test("new tasks go after the last one", async () => {
  const { deps, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  expect(
    (await taskRow(deps, a.id)).sortKey < (await taskRow(deps, b.id)).sortKey,
  ).toBe(true);
  await close();
});

test("create with parentId links the subtask", async () => {
  const { deps, mk, close } = await setup();
  const parent = await mk("Parent");
  const child = await mk("Child", { parentId: parent.id });
  expect(await childrenOf(deps, parent.id)).toEqual([child.id]);
  await close();
});

test("create refuses a subtask as parent", async () => {
  const { deps, caller, mk, close } = await setup();
  const parent = await mk("Parent");
  const child = await mk("Child", { parentId: parent.id });
  const before = await count(deps, "items");
  await expect(
    caller.tasks.create({ title: "Grandchild", parentId: child.id }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "A subtask can't have subtasks",
  });
  expect(await count(deps, "items")).toBe(before);
  await close();
});

test("create refuses a parent that isn't a task", async () => {
  const { deps, caller, close } = await setup();
  const note = await writeItems(deps, (w) =>
    w.createItem({ type: "note", title: "A note" }),
  );
  await expect(
    caller.tasks.create({ title: "Child", parentId: note.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await close();
});

test("addParent refuses a child that has subtasks", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  await mk("B1", { parentId: b.id });
  await expect(
    caller.tasks.addParent({ id: b.id, parentId: a.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await childrenOf(deps, a.id)).toEqual([]);
  await close();
});

test("addParent links, and refuses a subtask as parent", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const c = await mk("C");
  await caller.tasks.addParent({ id: b.id, parentId: a.id });
  expect(await childrenOf(deps, a.id)).toEqual([b.id]);
  await expect(
    caller.tasks.addParent({ id: c.id, parentId: b.id }),
  ).rejects.toMatchObject({
    code: "BAD_REQUEST",
    message: "A subtask can't have subtasks",
  });
  await close();
});

test("removeParent unlinks, and refuses a task that isn't a parent", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B", { parentId: a.id });
  const c = await mk("C");
  await expect(
    caller.tasks.removeParent({ id: b.id, parentId: c.id }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await caller.tasks.removeParent({ id: b.id, parentId: a.id });
  expect(await childrenOf(deps, a.id)).toEqual([]);
  await close();
});

test("update notes writes search_text", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const out = await caller.tasks.update({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
    title: "A2",
    notes: "Some notes",
    priority: "high",
  });
  expect(out.result.title).toBe("A2");
  expect(await itemRow(deps, a.id)).toMatchObject({
    search_text: "Some notes",
  });
  expect(await taskRow(deps, a.id)).toMatchObject({
    notes: "Some notes",
    priority: "high",
  });
  await caller.tasks.update({
    id: a.id,
    expectedUpdatedAt: out.result.updatedAt,
    notes: "",
  });
  expect(await itemRow(deps, a.id)).toMatchObject({ search_text: null });
  expect((await taskRow(deps, a.id)).notes).toBeNull();
  await close();
});

test("due null clears both columns", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const timed = await caller.tasks.update({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
    due: {
      dateTime: "2026-11-06T09:00:00-08:00",
      timeZone: "America/Los_Angeles",
    },
  });
  const dated = await caller.tasks.reschedule({
    id: a.id,
    expectedUpdatedAt: timed.result.updatedAt,
    due: { date: "2026-11-07" },
  });
  expect(await taskRow(deps, a.id)).toMatchObject({
    dueDate: "2026-11-07",
    dueAt: null,
    dueTz: null,
  });
  const timedAgain = await caller.tasks.reschedule({
    id: a.id,
    expectedUpdatedAt: dated.result.updatedAt,
    due: { dateTime: "2026-11-08T09:00:00Z" },
  });
  await caller.tasks.update({
    id: a.id,
    expectedUpdatedAt: timedAgain.result.updatedAt,
    due: null,
  });
  expect(await taskRow(deps, a.id)).toMatchObject({
    dueDate: null,
    dueAt: null,
    dueTz: null,
  });
  await close();
});

test("an unknown time zone is refused", async () => {
  const { caller, mk, close } = await setup();
  const a = await mk("A");
  await expect(
    caller.tasks.reschedule({
      id: a.id,
      expectedUpdatedAt: a.updatedAt,
      due: { dateTime: "2026-11-08T09:00:00Z", timeZone: "Mars/Olympus" },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await close();
});

test("complete reports parentsNowDone only when all subtasks are done", async () => {
  const { deps, caller, mk, close } = await setup();
  const p = await mk("Parent");
  const other = await mk("Other parent");
  const s1 = await mk("S1", { parentId: p.id });
  const s2 = await mk("S2", { parentId: p.id });
  await caller.tasks.addParent({ id: s2.id, parentId: other.id });
  const first = await caller.tasks.complete({
    id: s1.id,
    expectedUpdatedAt: s1.updatedAt,
  });
  expect(first.result.parentsNowDone).toEqual([]);
  expect((await taskRow(deps, s1.id)).completedAt).toEqual(deps.now());
  const second = await caller.tasks.complete({
    id: s2.id,
    expectedUpdatedAt: await version(deps, s2.id),
  });
  expect(second.result.parentsNowDone.map((x) => x.title)).toEqual([
    "Parent",
    "Other parent",
  ]);
  expect(second.result.task.id).toBe(s2.id);
  // It never completes the parent itself.
  expect((await taskRow(deps, p.id)).completedAt).toBeNull();
  await close();
});

test("complete twice is a no-op", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const first = await caller.tasks.complete({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
  });
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  // A stale version is no conflict: nothing is written.
  const second = await caller.tasks.complete({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
  });
  expect(second.result.task.updatedAt).toBe(first.result.task.updatedAt);
  expect(second.result.parentsNowDone).toEqual([]);
  expect((await taskRow(deps, a.id)).completedAt).toEqual(
    new Date("2026-10-30T12:00:00.000Z"),
  );

  const b = await mk("B");
  const reopened = await caller.tasks.reopen({
    id: b.id,
    expectedUpdatedAt: "2020-01-01T00:00:00.000Z",
  });
  expect(reopened.result.updatedAt).toBe(b.updatedAt);
  await close();
});

test("overlapping completes and reopens are no-ops, not conflicts", async () => {
  const { caller, mk, close } = await setup();
  const a = await mk("A");
  const v = { id: a.id, expectedUpdatedAt: a.updatedAt };
  const [one, two] = await Promise.all([
    caller.tasks.complete(v),
    caller.tasks.complete(v),
  ]);
  expect(one.result.task.updatedAt).toBe(two.result.task.updatedAt);
  const done = { id: a.id, expectedUpdatedAt: one.result.task.updatedAt };
  const [three, four] = await Promise.all([
    caller.tasks.reopen(done),
    caller.tasks.reopen(done),
  ]);
  expect(three.result.updatedAt).toBe(four.result.updatedAt);
  await close();
});

test("reopen clears completed_at", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const done = await caller.tasks.complete({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
  });
  await caller.tasks.reopen({
    id: a.id,
    expectedUpdatedAt: done.result.task.updatedAt,
  });
  expect((await taskRow(deps, a.id)).completedAt).toBeNull();
  await close();
});

test("completing a parent leaves subtasks open", async () => {
  const { deps, caller, mk, close } = await setup();
  const p = await mk("Parent");
  const s = await mk("S", { parentId: p.id });
  await caller.tasks.complete({
    id: p.id,
    expectedUpdatedAt: await version(deps, p.id),
  });
  expect((await taskRow(deps, p.id)).completedAt).not.toBeNull();
  expect((await taskRow(deps, s.id)).completedAt).toBeNull();
  await close();
});

test("rescheduleMany is all or nothing", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const before = await snapshot(deps);
  await expect(
    caller.tasks.rescheduleMany({
      items: [
        { id: a.id, expectedUpdatedAt: a.updatedAt },
        { id: b.id, expectedUpdatedAt: "2020-01-01T00:00:00.000Z" },
      ],
      due: { date: "2026-11-09" },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await snapshot(deps)).toEqual(before);
  expect(await version(deps, a.id)).toBe(a.updatedAt);

  const out = await caller.tasks.rescheduleMany({
    items: [
      { id: a.id, expectedUpdatedAt: a.updatedAt },
      { id: b.id, expectedUpdatedAt: b.updatedAt },
    ],
    due: { date: "2026-11-09" },
  });
  expect(out.result.map((x) => x.id)).toEqual([a.id, b.id]);
  expect((await taskRow(deps, a.id)).dueDate).toBe("2026-11-09");
  expect((await taskRow(deps, b.id)).dueDate).toBe("2026-11-09");
  await close();
});

test("reorder top/bottom/after writes one row", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const c = await mk("C");
  const order = async () =>
    (
      await deps.db.execute<{ title: string }>(sql`
        select i.title from tasks t join items i on i.id = t.item_id
        order by t.sort_key collate "C"`)
    ).map((r) => r.title);
  const keys = async () =>
    Object.fromEntries(
      (await deps.db.select().from(tasks)).map((r) => [r.itemId, r.sortKey]),
    );

  const reorder = async (
    id: string,
    position: "top" | "bottom" | { after: string },
  ) => {
    const before = await keys();
    await caller.tasks.reorder({
      id,
      expectedUpdatedAt: await version(deps, id),
      position,
    });
    const after = await keys();
    const changed = Object.keys(after).filter((k) => after[k] !== before[k]);
    expect(changed).toEqual([id]);
  };

  await reorder(c.id, "top");
  expect(await order()).toEqual(["C", "A", "B"]);
  await reorder(c.id, "bottom");
  expect(await order()).toEqual(["A", "B", "C"]);
  await reorder(a.id, { after: b.id });
  expect(await order()).toEqual(["B", "A", "C"]);
  await reorder(c.id, { after: b.id });
  expect(await order()).toEqual(["B", "C", "A"]);
  await expect(
    caller.tasks.reorder({
      id: a.id,
      expectedUpdatedAt: await version(deps, a.id),
      position: { after: a.id },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await close();
});

test("delete takes only unshared subtasks", async () => {
  const { deps, mk, close } = await setup();
  const p = await mk("P");
  const q = await mk("Q");
  const own = await mk("Own", { parentId: p.id });
  const shared = await mk("Shared", { parentId: p.id });
  await writeItems(deps, (w) =>
    w.addLink({ fromId: q.id, toId: shared.id, kind: "contains" }),
  );
  await setDeleted(deps, p.id, true);
  expect((await itemRow(deps, own.id)).deleted).toBe(true);
  expect((await itemRow(deps, shared.id)).deleted).toBe(false);

  // restore brings them back
  deps.setNow(new Date("2026-10-30T13:00:00.000Z"));
  await setDeleted(deps, p.id, false);
  expect((await itemRow(deps, p.id)).deleted).toBe(false);
  expect((await itemRow(deps, own.id)).deleted).toBe(false);
  await close();
});

test("a subtask whose other parent is deleted goes with the last one", async () => {
  const { deps, mk, close } = await setup();
  const p = await mk("P");
  const q = await mk("Q");
  const shared = await mk("Shared", { parentId: p.id });
  await writeItems(deps, (w) =>
    w.addLink({ fromId: q.id, toId: shared.id, kind: "contains" }),
  );
  await setDeleted(deps, q.id, true);
  expect((await itemRow(deps, shared.id)).deleted).toBe(false);
  await setDeleted(deps, p.id, true);
  expect((await itemRow(deps, shared.id)).deleted).toBe(true);
  await close();
});

test("each mutation of a task moves updated_at and publishes it", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const v = (id: string) => version(deps, id);
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.tasks.update({ id, expectedUpdatedAt: await v(id), title: "A2" }),
    a.id,
  );
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.tasks.update({ id, expectedUpdatedAt: await v(id), notes: "n" }),
    a.id,
  );
  await expectModuleWrites(
    deps,
    async (id) => caller.tasks.complete({ id, expectedUpdatedAt: await v(id) }),
    a.id,
  );
  await expectModuleWrites(
    deps,
    async (id) => caller.tasks.reopen({ id, expectedUpdatedAt: await v(id) }),
    a.id,
  );
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.tasks.reschedule({
        id,
        expectedUpdatedAt: await v(id),
        due: { date: "2026-11-06" },
      }),
    a.id,
  );
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.tasks.rescheduleMany({
        items: [{ id, expectedUpdatedAt: await v(id) }],
        due: null,
      }),
    a.id,
  );
  await expectModuleWrites(
    deps,
    async (id) =>
      caller.tasks.reorder({
        id,
        expectedUpdatedAt: await v(id),
        position: "top",
      }),
    a.id,
  );
  // Creating and linking change no existing row, so they only publish.
  await expectTracked(deps, {}, () => mk("C"));
  await expectTracked(deps, {}, async () => {
    await caller.tasks.addParent({ id: b.id, parentId: a.id });
    return { id: b.id };
  });
  await expectTracked(deps, {}, async () => {
    await caller.tasks.removeParent({ id: b.id, parentId: a.id });
    return { id: a.id };
  });
  await close();
});

test("each mutation's undo restores the prior state", async () => {
  const { deps, caller, mk, close } = await setup();
  type Case = {
    op: string;
    run: (ids: { a: string; b: string; p: string }) => Promise<{
      undo: { record?: unknown; created: string[] };
    }>;
  };
  const v = (id: string) => version(deps, id);
  const cases: Case[] = [
    { op: "create", run: () => caller.tasks.create({ title: "New" }) },
    {
      op: "create",
      run: ({ p }) => caller.tasks.create({ title: "Sub", parentId: p }),
    },
    {
      op: "update",
      run: async ({ a }) =>
        caller.tasks.update({
          id: a,
          expectedUpdatedAt: await v(a),
          title: "Renamed",
          notes: "Notes",
          priority: "high",
          due: {
            dateTime: "2026-11-06T09:00:00-08:00",
            timeZone: "America/Los_Angeles",
          },
        }),
    },
    {
      op: "complete",
      run: async ({ a }) =>
        caller.tasks.complete({ id: a, expectedUpdatedAt: await v(a) }),
    },
    {
      op: "reopen",
      run: async ({ b }) =>
        caller.tasks.reopen({ id: b, expectedUpdatedAt: await v(b) }),
    },
    {
      op: "reschedule",
      run: async ({ a }) =>
        caller.tasks.reschedule({
          id: a,
          expectedUpdatedAt: await v(a),
          due: { date: "2026-12-01" },
        }),
    },
    {
      op: "rescheduleMany",
      run: async ({ a, b }) =>
        caller.tasks.rescheduleMany({
          items: [
            { id: a, expectedUpdatedAt: await v(a) },
            { id: b, expectedUpdatedAt: await v(b) },
          ],
          due: null,
        }),
    },
    {
      op: "reorder",
      run: async ({ a }) =>
        caller.tasks.reorder({
          id: a,
          expectedUpdatedAt: await v(a),
          position: "bottom",
        }),
    },
    {
      op: "addParent",
      run: ({ a, p }) => caller.tasks.addParent({ id: a, parentId: p }),
    },
    {
      op: "removeParent",
      run: ({ b, p }) => caller.tasks.removeParent({ id: b, parentId: p }),
    },
  ];
  const p = await mk("P");
  const a = (
    await caller.tasks.create({
      title: "A",
      notes: "Old notes",
      due: { date: "2026-11-03" },
    })
  ).result;
  const b = await mk("B", { parentId: p.id });
  await caller.tasks.complete({ id: b.id, expectedUpdatedAt: await v(b.id) });

  const ops = new Set<string>();
  for (const c of cases) {
    const before = await snapshot(deps);
    const out = await c.run({ a: a.id, b: b.id, p: p.id });
    expect(await snapshot(deps), c.op).not.toEqual(before);
    deps.setNow(new Date(deps.now().getTime() + 1000));
    await caller.ops.undo({ id: `tasks.${c.op}`, token: out.undo });
    expect(await snapshot(deps), c.op).toEqual(before);
    ops.add(c.op);
  }
  const mutations = Object.entries(tasksServer.operations)
    .filter(([, op]) => op.kind === "mutation")
    .map(([key]) => key);
  expect([...ops].sort()).toEqual(mutations.sort());
  await close();
});

test("undo after a later edit conflicts", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const out = await caller.tasks.complete({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
  });
  await caller.tasks.update({
    id: a.id,
    expectedUpdatedAt: out.result.task.updatedAt,
    title: "A2",
  });
  await expect(
    caller.ops.undo({ id: "tasks.complete", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  expect((await taskRow(deps, a.id)).completedAt).not.toBeNull();
  await close();
});

test("seed writes 12 tasks across every group, 2 with 3 subtasks", async () => {
  const { deps, close } = await setup();
  await writeItems(deps, (w) => seed(w));
  const rows = await deps.db.execute<{
    id: string;
    day: string | null;
    children: number;
    parents: number;
  }>(sql`
    select t.item_id as id, coalesce(t.due_date::text, to_char(t.due_at at time zone 'UTC', 'YYYY-MM-DD')) as day,
      (select count(*)::int from links l where l.from_id = t.item_id and l.kind = 'contains') as children,
      (select count(*)::int from links l where l.to_id = t.item_id and l.kind = 'contains') as parents
    from tasks t`);
  const top = rows.filter((r) => r.parents === 0);
  expect(top).toHaveLength(12);
  expect(top.filter((r) => r.children === 3)).toHaveLength(2);
  expect(rows.filter((r) => r.parents === 1)).toHaveLength(6);
  const today = new Date().toISOString().slice(0, 10);
  const days = top.map((r) => r.day);
  expect(days.some((d) => d !== null && d < today)).toBe(true);
  expect(days.some((d) => d === today)).toBe(true);
  expect(days.some((d) => d !== null && d > today)).toBe(true);
  expect(days.some((d) => d === null)).toBe(true);
  await close();
});
