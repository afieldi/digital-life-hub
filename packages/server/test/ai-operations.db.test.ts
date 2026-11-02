import { coreAiActions, describeOperation, fields } from "@dlh/core";
import { aiRequests, items, links } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { and, eq, ilike, isNull } from "drizzle-orm";
import { z } from "zod";
import {
  type AiError,
  apply,
  CORE_ROUTER_IDS,
  collectServerModules,
  complete,
  coreAiRunners,
  defineServerModule,
  implementOperation,
  moduleAiActions,
  prepare,
  undo,
  writeItems,
} from "../src";
import { getItem } from "../src/items/read";
import { freshTestDb, testDeps } from "../src/testing";

const versioned = { id: z.uuid(), expectedUpdatedAt: z.iso.datetime() };

const createDesc = describeOperation({
  id: "test.create",
  kind: "mutation",
  label: "New test",
  description: "Creates a test item, optionally under a parent.",
  appliesTo: ["*", "none"],
  input: z.object({
    title: z.string().min(1),
    parentId: fields.item(["test"]).optional(),
  }),
  subject: (i) => i.parentId ?? null,
  effects: ["createItems", "addLinks"],
  summary: (i) => `New test ${i.title}`,
});

const renameDesc = describeOperation({
  id: "test.rename",
  kind: "mutation",
  label: "Rename test",
  description: "Renames the test item.",
  appliesTo: ["test"],
  input: z.object({ ...versioned, title: z.string().min(1) }),
  subject: (i) => i.id,
  effects: ["updateItem"],
  summary: (i) => `Rename to ${i.title}`,
});

const findDesc = describeOperation({
  id: "test.find",
  kind: "query",
  label: "Find tests",
  description: "Lists test items whose title contains the text.",
  appliesTo: ["*", "none"],
  input: z.object({ text: z.string(), timeZone: z.string() }),
  subject: () => null,
  effects: [],
  summary: (i) => `Find ${i.text}`,
});

const hiddenDesc = describeOperation({
  id: "test.hidden",
  kind: "query",
  label: "Hidden",
  description: "Not for AI.",
  appliesTo: "none",
  input: z.object({}),
  subject: () => null,
  effects: [],
  summary: () => "Hidden",
  ai: false,
});

const testModule = defineServerModule({
  id: "test",
  itemTypes: ["test"],
  operations: {
    create: implementOperation(createDesc, {
      async run(w, input) {
        const item = await w.createItem?.({ type: "test", title: input.title });
        if (!item) throw new Error("no createItem");
        if (input.parentId) {
          await w.addLink?.({
            fromId: input.parentId,
            toId: item.id,
            kind: "relates",
          });
        }
        return { result: item, undo: null };
      },
      async undo() {},
      undoRecord: z.null(),
    }),
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
    find: implementOperation(findDesc, {
      async run(deps, input) {
        const rows = await deps.db
          .select()
          .from(items)
          .where(
            and(ilike(items.title, `%${input.text}%`), isNull(items.deletedAt)),
          );
        return {
          heading: `Found in ${input.timeZone}`,
          items: rows.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            archivedAt: null,
            extra: 1,
          })),
        };
      },
    }),
    hidden: implementOperation(hiddenDesc, {
      async run() {
        return { heading: "Hidden", items: [] };
      },
    }),
  },
});

const NOW = new Date("2026-11-02T20:00:00.000Z");

async function setup() {
  const { db, close } = await freshTestDb();
  const collected = collectServerModules([testModule], [...CORE_ROUTER_IDS], {
    actions: Object.values(coreAiActions),
    runners: coreAiRunners,
  });
  const deps = testDeps(db, {
    now: () => NOW,
    ai: { runners: collected.aiRunners },
    operations: collected.operations,
  });
  let t = NOW.getTime();
  const tick = () => {
    t += 1000;
    deps.setNow(new Date(t));
  };
  const mk = (title: string) =>
    writeItems(deps, (w) => w.createItem({ type: "test", title }));
  return { db, deps, fake: deps.fakeProvider, mk, tick, close };
}

async function rowOf(db: Awaited<ReturnType<typeof setup>>["db"], id: string) {
  const [row] = await db.select().from(aiRequests).where(eq(aiRequests.id, id));
  if (!row) throw new Error("no row");
  return row;
}

async function caught(p: Promise<unknown>): Promise<TRPCError> {
  const e = await p.then(
    () => null,
    (err: unknown) => err,
  );
  expect(e).toBeInstanceOf(TRPCError);
  return e as TRPCError;
}

test("operation do runs the mutation with Undo", async () => {
  const s = await setup();
  const a = await s.mk("Old");
  s.fake.queue(JSON.stringify({ title: "New" }));
  const res = await prepare(s.deps, {
    text: "rename to New",
    itemId: a.id,
    actionId: "test.rename",
    kind: "do",
  });
  expect(res).toEqual({
    requestId: expect.any(String),
    status: "applied",
    summary: "Rename to New",
  });
  // The model is asked for the input without the item keys.
  const schema = s.fake.calls[0]?.schema as {
    properties: Record<string, unknown>;
  };
  expect(Object.keys(schema.properties)).toEqual(["title"]);
  expect((await getItem(s.db, a.id)).title).toBe("New");

  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  expect((await getItem(s.db, a.id)).title).toBe("Old");
  expect((await rowOf(s.db, res.requestId)).status).toBe("undone");
  await s.close();
});

test("operation suggest offers options and applyOption runs one", async () => {
  const s = await setup();
  const a = await s.mk("Old");
  s.fake.queue(
    JSON.stringify({
      options: [
        { label: "Short", title: "S" },
        { label: "Long", title: "A longer one" },
      ],
    }),
  );
  const res = await prepare(s.deps, {
    text: "rename",
    itemId: a.id,
    actionId: "test.rename",
    kind: "suggest",
  });
  expect(res).toEqual({
    requestId: expect.any(String),
    status: "suggested",
    options: [{ label: "Short" }, { label: "Long" }],
  });
  expect((await getItem(s.db, a.id)).title).toBe("Old");
  s.tick();
  const applied = await apply(s.deps, { requestId: res.requestId, option: 1 });
  expect(applied.summary).toBe("Rename to A longer one");
  expect((await getItem(s.db, a.id)).title).toBe("A longer one");
  await s.close();
});

test("query ask returns listed rows", async () => {
  const s = await setup();
  const a = await s.mk("Alpha one");
  await s.mk("Beta");
  s.fake.queue(JSON.stringify({ text: "alpha" }));
  const res = await prepare(s.deps, {
    text: "find alpha",
    actionId: "test.find",
    kind: "ask",
    timeZone: "Europe/Warsaw",
  });
  expect(res).toEqual({
    requestId: expect.any(String),
    status: "listed",
    heading: "Found in Europe/Warsaw",
    items: [{ id: a.id, type: "test", title: "Alpha one", archivedAt: null }],
  });
  // One model call; the zone is never asked of the model.
  expect(s.fake.calls).toHaveLength(1);
  const schema = s.fake.calls[0]?.schema as {
    properties: Record<string, unknown>;
  };
  expect(Object.keys(schema.properties)).toEqual(["text"]);
  expect((await rowOf(s.db, res.requestId)).status).toBe("listed");
  await s.close();
});

test("a CLI query falls back to UTC and keeps the zone until complete", async () => {
  const s = await setup();
  await s.mk("Alpha");
  const run = await prepare(s.deps, {
    text: "find alpha",
    actionId: "test.find",
    kind: "ask",
    provider: "claude-cli",
    timeZone: "Asia/Tokyo",
  });
  if (run.status !== "run") throw new Error("expected a CLI run");
  const res = await complete(s.deps, {
    requestId: run.requestId,
    raw: JSON.stringify({
      type: "result",
      is_error: false,
      result: JSON.stringify({ text: "alpha" }),
    }),
  });
  expect(res).toMatchObject({
    status: "listed",
    heading: "Found in Asia/Tokyo",
  });

  s.fake.queue(JSON.stringify({ text: "alpha" }));
  const utc = await prepare(s.deps, {
    text: "find alpha",
    actionId: "test.find",
    kind: "ask",
  });
  expect(utc).toMatchObject({ status: "listed", heading: "Found in UTC" });
  await s.close();
});

test("an ambiguous item title drops to suggested with matches", async () => {
  const s = await setup();
  const p1 = await s.mk("Groceries list");
  const p2 = await s.mk("Groceries plan");
  s.fake.queue(JSON.stringify({ title: "Milk", parentId: "Groceries" }));
  const res = await prepare(s.deps, {
    text: "add milk under groceries",
    actionId: "test.create",
    kind: "do",
  });
  expect(res.status).toBe("suggested");
  if (res.status !== "suggested") throw new Error();
  expect(res.options.map((o) => o.label).sort()).toEqual([
    "New test: Groceries list",
    "New test: Groceries plan",
  ]);
  const before = await s.db.select().from(items);
  expect(before).toHaveLength(2);

  // On no item, a subtask can't go under another item.
  s.tick();
  const pick = res.options.findIndex((o) => o.label.endsWith("plan"));
  const err = await caught(
    apply(s.deps, { requestId: res.requestId, option: pick }),
  );
  expect((err.cause as AiError).code).toBe("bad_output");
  expect(await s.db.select().from(items)).toHaveLength(2);
  void p1;
  void p2;
  await s.close();
});

test("one exact match runs", async () => {
  const s = await setup();
  const parent = await s.mk("Groceries");
  await s.mk("Groceries plan");
  s.fake.queue(JSON.stringify({ title: "Milk", parentId: " groceries " }));
  const res = await prepare(s.deps, {
    text: "add milk here",
    itemId: parent.id,
    actionId: "test.create",
    kind: "do",
  });
  expect(res).toMatchObject({ status: "applied", summary: "New test Milk" });
  const made = await s.db.select().from(items).where(eq(items.title, "Milk"));
  expect(made).toHaveLength(1);
  const link = await s.db
    .select()
    .from(links)
    .where(eq(links.fromId, parent.id));
  expect(link.map((l) => l.toId)).toEqual([made[0]?.id]);
  await s.close();
});

test("a title that matches nothing fails without writing", async () => {
  const s = await setup();
  s.fake.queue(JSON.stringify({ title: "Milk", parentId: "Nowhere" }));
  const err = await caught(
    prepare(s.deps, { text: "x", actionId: "test.create", kind: "do" }),
  );
  expect((err.cause as AiError).code).toBe("not_found");
  expect(await s.db.select().from(items)).toHaveLength(0);
  await s.close();
});

test("undo soft-deletes created items", async () => {
  const s = await setup();
  s.fake.queue(JSON.stringify({ title: "Milk" }));
  const res = await prepare(s.deps, {
    text: "add milk",
    actionId: "test.create",
    kind: "do",
  });
  expect(res.status).toBe("applied");
  const [made] = await s.db.select().from(items);
  if (!made) throw new Error("nothing created");
  const row = await rowOf(s.db, res.requestId);
  expect(row.undo).toEqual({ record: null, created: [made.id] });
  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  const [after] = await s.db.select().from(items).where(eq(items.id, made.id));
  expect(after?.deletedAt).not.toBeNull();
  await s.close();
});

test("prompt carries today in the zone", async () => {
  const s = await setup();
  // 2026-11-03 01:00 in Warsaw, still Nov 2 in Los Angeles.
  s.deps.setNow(new Date("2026-11-03T00:00:00.000Z"));
  s.fake.queue(JSON.stringify({ text: "x" }), JSON.stringify({ text: "x" }));
  await prepare(s.deps, {
    text: "find x",
    actionId: "test.find",
    kind: "ask",
    timeZone: "America/Los_Angeles",
  });
  expect(s.fake.calls[0]?.prompt).toMatch(
    /^Today is Mon, Nov 2, 2026 \(America\/Los_Angeles\)\.\n<instruction>/,
  );
  await prepare(s.deps, { text: "find x", actionId: "test.find", kind: "ask" });
  expect(s.fake.calls[1]?.prompt).toMatch(/^<instruction>/);
  const err = await caught(
    prepare(s.deps, {
      text: "find x",
      actionId: "test.find",
      kind: "ask",
      timeZone: "Mars/Olympus",
    }),
  );
  expect(err.code).toBe("BAD_REQUEST");
  await s.close();
});

test("actions derived from operations pass collectAiRunners", async () => {
  const actions = moduleAiActions(testModule);
  expect(actions.map((a) => [a.id, a.kinds])).toEqual([
    ["test.create", ["suggest", "do"]],
    ["test.rename", ["suggest", "do"]],
    ["test.find", ["ask"]],
  ]);
  const { aiRunners } = collectServerModules(
    [testModule],
    [...CORE_ROUTER_IDS],
    { actions: [], runners: [] },
  );
  expect([...aiRunners.keys()]).toEqual([
    "test.create",
    "test.rename",
    "test.find",
  ]);
  const create = aiRunners.get("test.create");
  const doShape = create?.output.do as z.ZodObject;
  expect(doShape.safeParse({ title: "x", parentId: "Groceries" }).success).toBe(
    true,
  );
  expect(create?.output.suggest).toBeDefined();
  expect(aiRunners.get("test.find")?.output.ask).toBeDefined();
});
