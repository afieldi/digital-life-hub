import { describeOperation } from "@dlh/core";
import { items, links } from "@dlh/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import {
  CORE_ROUTER_IDS,
  type CoreDeps,
  collectServerModules,
  coreRouters,
  defineServerModule,
  implementOperation,
  moduleRouter,
  operationsRouter,
  router,
  writeItems,
} from "../src";
import { freshTestDb, testDeps } from "../src/testing";

const versioned = {
  id: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
};

const renameDesc = describeOperation({
  id: "test.rename",
  kind: "mutation",
  label: "Rename",
  description: "Rename the item.",
  appliesTo: ["test"],
  input: z.object({ ...versioned, title: z.string() }),
  subject: (i) => i.id,
  effects: ["updateItem"],
  summary: (i) => `Rename to ${i.title}`,
});

const makeDesc = describeOperation({
  id: "test.make",
  kind: "mutation",
  label: "Make",
  description: "Make items.",
  appliesTo: "none",
  input: z.object({ titles: z.string() }),
  subject: () => null,
  effects: ["createItems"],
  summary: (i) => `Make ${i.titles}`,
});

const unlinkDesc = describeOperation({
  id: "test.unlink",
  kind: "mutation",
  label: "Unlink",
  description: "Remove a link.",
  appliesTo: ["test"],
  input: z.object({ id: z.uuid(), linkId: z.uuid() }),
  subject: (i) => i.id,
  effects: ["removeLinks"],
  summary: () => "Unlink",
  palette: false,
});

const peekDesc = describeOperation({
  id: "test.peek",
  kind: "query",
  label: "Peek",
  description: "Peek at an item.",
  appliesTo: ["test"],
  input: z.object({ id: z.uuid() }),
  subject: (i) => i.id,
  effects: [],
  summary: () => "Peek",
});

const titleOf = async (deps: CoreDeps, id: string) =>
  (await deps.db.select().from(items).where(eq(items.id, id)))[0];

let peekArgs: unknown[] = [];

const testModule = defineServerModule({
  id: "test",
  itemTypes: ["test"],
  operations: {
    rename: implementOperation(renameDesc, {
      async run(w, input) {
        const [before] = await w.tx
          .select({ title: items.title })
          .from(items)
          .where(eq(items.id, input.id));
        const item = await w.updateItem?.(input);
        if (!item || !before) throw new Error("no writer");
        return {
          result: item,
          undo: { id: item.id, title: before.title, updatedAt: item.updatedAt },
        };
      },
      async undo(w, record) {
        await w.updateItem?.({
          id: record.id,
          expectedUpdatedAt: record.updatedAt,
          title: record.title,
        });
      },
      undoRecord: z.object({
        id: z.uuid(),
        title: z.string(),
        updatedAt: z.string(),
      }),
    }),
    make: implementOperation(makeDesc, {
      async run(w, input) {
        const made = [];
        for (const title of input.titles.split(",")) {
          const item = await w.createItem?.({ type: "test", title });
          if (item) made.push(item.id);
        }
        return { result: made, undo: null };
      },
      async undo() {},
      undoRecord: z.null(),
    }),
    unlink: implementOperation(unlinkDesc, {
      async run(w, input) {
        await w.removeLink?.(input.linkId);
        return { result: true, undo: null };
      },
      async undo() {},
      undoRecord: z.null(),
    }),
    peek: implementOperation(peekDesc, {
      async run(...args) {
        peekArgs = args;
        const [deps, input] = args;
        return (await titleOf(deps, input.id))?.title ?? null;
      },
    }),
  },
});

const session = { id: "s", email: "arek@example.com" };

async function setup() {
  const { db, close } = await freshTestDb();
  const collected = collectServerModules([testModule], [...CORE_ROUTER_IDS], {
    actions: [],
    runners: [],
  });
  const deps = testDeps(db, { operations: collected.operations });
  const app = router({
    ...coreRouters,
    test: operationsRouter(testModule.operations),
  });
  const caller = app.createCaller({
    deps,
    session,
    principal: { kind: "user", session },
  });
  const mk = (title: string) =>
    writeItems(deps, (w) => w.createItem({ type: "test", title }));
  return { db, deps, caller, mk, close };
}

test("module router mounts operations under the module id", async () => {
  const mounted = router({ test: moduleRouter(testModule) });
  expect(Object.keys(mounted._def.procedures).sort()).toEqual([
    "test.make",
    "test.peek",
    "test.rename",
    "test.unlink",
  ]);
  const procedures: Record<string, { _def: { type: string } }> =
    mounted._def.procedures;
  expect(procedures["test.peek"]?._def.type).toBe("query");
  expect(procedures["test.rename"]?._def.type).toBe("mutation");
  const { caller, mk, close } = await setup();
  const a = await mk("A");
  const out = await caller.test.rename({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
    title: "A2",
  });
  expect(out.result.title).toBe("A2");
  expect(await caller.test.peek({ id: a.id })).toBe("A2");
  await close();
});

test("mutation runs through the scoped writer", async () => {
  const { deps, mk, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const sneaky = implementOperation(renameDesc, {
    async run(w) {
      const item = await w.updateItem?.({
        id: b.id,
        expectedUpdatedAt: b.updatedAt,
        title: "B2",
      });
      return { result: item, undo: null };
    },
    async undo() {},
    undoRecord: z.null(),
  });
  const caller = router({
    test: operationsRouter({ rename: sneaky }),
  }).createCaller({
    deps,
    session,
    principal: { kind: "user", session },
  });
  await expect(
    caller.test.rename({
      id: a.id,
      expectedUpdatedAt: a.updatedAt,
      title: "x",
    }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect((await titleOf(deps, b.id))?.title).toBe("B");
  await close();
});

test("mutation returns an undo token and ops.undo restores", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const out = await caller.test.rename({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
    title: "A2",
  });
  expect(out.undo).toEqual({
    record: { id: a.id, title: "A", updatedAt: out.result.updatedAt },
    created: [],
  });
  const undone = await caller.ops.undo({ id: "test.rename", token: out.undo });
  expect(undone).toEqual({ summary: "Undid rename" });
  expect((await titleOf(deps, a.id))?.title).toBe("A");
  await close();
});

test("undo soft-deletes created items", async () => {
  const { deps, caller, close } = await setup();
  const out = await caller.test.make({ titles: "x,y" });
  expect(out.undo.created).toEqual(out.result);
  expect(out.result).toHaveLength(2);
  // A created item edited since is still removed: Core deletes at its current version.
  const [first] = out.result;
  const row = await titleOf(deps, first ?? "");
  await writeItems(deps, (w) =>
    w.updateItem({
      id: first ?? "",
      expectedUpdatedAt: row?.updatedAt.toISOString() ?? "",
      title: "x2",
    }),
  );
  await caller.ops.undo({ id: "test.make", token: out.undo });
  for (const id of out.result) {
    expect((await titleOf(deps, id))?.deletedAt).not.toBeNull();
  }
  await close();
});

test("undo after a later edit conflicts", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  const made = await caller.test.make({ titles: "kept" });
  const first = await caller.test.rename({
    id: a.id,
    expectedUpdatedAt: a.updatedAt,
    title: "A2",
  });
  await caller.items.rename({
    id: a.id,
    expectedUpdatedAt: first.result.updatedAt,
    title: "A3",
  });
  await expect(
    caller.ops.undo({
      id: "test.rename",
      // Created ids from another call ride along to show nothing is reverted.
      token: { ...first.undo, created: made.result },
    }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  expect((await titleOf(deps, a.id))?.title).toBe("A3");
  expect((await titleOf(deps, made.result[0] ?? ""))?.deletedAt).toBeNull();
  await close();
});

test("ops.undo refuses a record its operation does not accept", async () => {
  const { caller, close } = await setup();
  await expect(
    caller.ops.undo({
      id: "test.rename",
      token: { record: { nope: 1 }, created: [] },
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.ops.undo({ id: "test.peek", token: { record: null, created: [] } }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  await expect(
    caller.ops.undo({ id: "test.nope", token: { record: null, created: [] } }),
  ).rejects.toMatchObject({ code: "NOT_FOUND" });
  await close();
});

test("query has no writer", async () => {
  const { deps, caller, mk, close } = await setup();
  const a = await mk("A");
  expect(await caller.test.peek({ id: a.id })).toBe("A");
  expect(peekArgs[0]).toBe(deps);
  expect(peekArgs[0]).not.toHaveProperty("tx");
  expect(peekArgs[0]).not.toHaveProperty("updateItem");
  await close();
});

test("removeLink only from the subject", async () => {
  const { db, caller, mk, deps, close } = await setup();
  const a = await mk("A");
  const b = await mk("B");
  const [ab, ba] = await writeItems(deps, async (w) => [
    await w.addLink({ fromId: a.id, toId: b.id, kind: "relates" }),
    await w.addLink({ fromId: b.id, toId: a.id, kind: "relates" }),
  ]);
  await expect(
    caller.test.unlink({ id: a.id, linkId: ba?.id ?? "" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await caller.test.unlink({ id: a.id, linkId: ab?.id ?? "" });
  const rows = await db.select().from(links);
  expect(rows.map((r) => r.id)).toEqual([ba?.id]);
  await close();
});

test("ops is a reserved router id", () => {
  expect(CORE_ROUTER_IDS).toContain("ops");
  expect(() =>
    collectServerModules(
      [defineServerModule({ id: "ops", itemTypes: [], operations: {} })],
      [...CORE_ROUTER_IDS],
      { actions: [], runners: [] },
    ),
  ).toThrow('Module id "ops" clashes with a core router');
});
