import {
  coreAiActions,
  describeAiAction,
  describeOperation,
  fields,
} from "@dlh/core";
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
  defineAiRunner,
  defineServerModule,
  implementOperation,
  itemContext,
  moduleAiActions,
  prepare,
  undo,
  writeItems,
} from "../src";
import { toolsFor } from "../src/ai/followups";
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

/** Two item fields: the model names both by title. */
const relateDesc = describeOperation({
  id: "test.relate",
  kind: "mutation",
  label: "Relate tests",
  description: "Links one test item to another.",
  appliesTo: ["*", "none"],
  input: z.object({
    fromId: fields.item(["test"]),
    toId: fields.item(["test"]),
  }),
  subject: (i) => i.fromId,
  effects: ["addLinks"],
  summary: () => "Relate",
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

/** Its subject is a plain id the model fills, not an item it names. */
const pokeDesc = describeOperation({
  id: "test.poke",
  kind: "mutation",
  label: "Poke",
  description: "Pokes another test item from this one.",
  appliesTo: ["test"],
  input: z.object({ id: z.uuid(), otherId: z.uuid() }),
  subject: (i) => i.otherId,
  effects: ["updateItem"],
  summary: () => "Poke",
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
    relate: implementOperation(relateDesc, {
      async run(w, input) {
        await w.addLink?.({
          fromId: input.fromId,
          toId: input.toId,
          kind: "relates",
        });
        return { result: null, undo: null };
      },
      async undo() {},
      undoRecord: z.null(),
    }),
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
    poke: implementOperation(pokeDesc, {
      async run(w, input) {
        const [other] = await w.tx
          .select({ updatedAt: items.updatedAt })
          .from(items)
          .where(eq(items.id, input.otherId));
        const item = await w.updateItem?.({
          id: input.otherId,
          expectedUpdatedAt: other?.updatedAt.toISOString() ?? "",
          title: "Poked",
        });
        return { result: item, undo: null };
      },
      async undo() {},
      undoRecord: z.null(),
    }),
    hidden: implementOperation(hiddenDesc, {
      async run() {
        return { heading: "Hidden", items: [] };
      },
    }),
  },
});

const brokenDesc = describeOperation({
  id: "broken.list",
  kind: "query",
  label: "Broken list",
  description: "A query that fails.",
  appliesTo: ["*", "none"],
  input: z.object({ text: z.string() }),
  subject: () => null,
  effects: [],
  summary: () => "Broken",
});

/** "missing" throws NOT_FOUND; anything else returns something that is no list. */
const brokenModule = defineServerModule({
  id: "broken",
  itemTypes: [],
  operations: {
    list: implementOperation(brokenDesc, {
      async run(_deps, input) {
        if (input.text === "missing") {
          throw new TRPCError({ code: "NOT_FOUND", message: "gone" });
        }
        return { nope: true };
      },
    }),
  },
});

/**
 * A hand-written runner that creates an item, and whose own undo record lists
 * the item on screen in the shapes Core reads `created` from.
 */
const handmade = defineAiRunner(
  describeAiAction({
    id: "handmade",
    label: "Handmade",
    description: "Creates an item by hand.",
    appliesTo: ["*", "none"],
    kinds: ["do"],
    effects: ["createItems"],
  }),
  {
    context: itemContext,
    system: "",
    output: { do: z.object({ title: z.string() }) },
    async apply(w, out, ctx) {
      const item = await w.createItem?.({
        type: "test",
        title: (out as { title: string }).title,
      });
      if (!item) throw new Error("no createItem");
      const listed = ctx.item?.id ?? item.id;
      return {
        created: [listed],
        kind: "created",
        record: null,
        operation: "handmade",
        token: { created: [listed] },
      };
    },
    async undo() {},
  },
);

/**
 * A hand-written runner that renames an item through Core's tools: the item
 * on screen, or `other` when the model names one.
 */
function renamer(id: string, effects: ("createItems" | "updateItem")[]) {
  return defineAiRunner(
    describeAiAction({
      id,
      label: "Renamer",
      description: "Renames through an operation.",
      appliesTo: ["test"],
      kinds: ["do"],
      effects,
    }),
    {
      context: itemContext,
      system: "",
      output: { do: z.object({ title: z.string(), other: z.string() }) },
      async apply(_w, out, ctx, tools) {
        const { title, other } = out as { title: string; other: string };
        const op = testModule.operations.rename;
        if (!tools || op.kind !== "mutation") throw new Error("no tools");
        const target = other || ctx.item?.id;
        await tools.mutate(op, {
          id: target,
          expectedUpdatedAt: ctx.version,
          title,
        });
        return null;
      },
    },
  );
}

const NOW = new Date("2026-11-02T20:00:00.000Z");

async function setup() {
  const { db, close } = await freshTestDb();
  const collected = collectServerModules(
    [testModule, brokenModule],
    [...CORE_ROUTER_IDS],
    { actions: Object.values(coreAiActions), runners: coreAiRunners },
  );
  const runners = new Map(collected.aiRunners);
  for (const r of [
    handmade,
    renamer("renameHere", ["updateItem"]),
    renamer("renameCreating", ["createItems"]),
  ]) {
    runners.set(r.action.id, r);
  }
  const deps = testDeps(db, {
    now: () => NOW,
    ai: { runners },
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

  // The parent is one the model named, resolved by search: it may be the
  // subject though no item is open.
  s.tick();
  const pick = res.options.findIndex((o) => o.label.endsWith("plan"));
  expect(
    await apply(s.deps, { requestId: res.requestId, option: pick }),
  ).toMatchObject({ status: "applied" });
  const linked = await s.db
    .select({ fromId: links.fromId })
    .from(links)
    .where(eq(links.kind, "relates"));
  expect(linked).toEqual([{ fromId: p2.id }]);
  void p1;
  await s.close();
});

test("two unclear item names fail rather than guess one", async () => {
  const s = await setup();
  for (const t of [
    "Groceries list",
    "Groceries plan",
    "Trip ideas",
    "Trip plan",
  ]) {
    await s.mk(t);
  }
  s.fake.queue(JSON.stringify({ fromId: "Groceries", toId: "Trip" }));
  const err = await caught(
    prepare(s.deps, { text: "relate", actionId: "test.relate", kind: "do" }),
  );
  expect((err.cause as AiError).code).toBe("bad_output");
  expect(err.message).toContain("Groceries");
  expect(err.message).toContain("Trip");
  expect(await s.db.select().from(links)).toHaveLength(0);
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

test("suggest skips an option naming nothing and keeps the rest", async () => {
  const s = await setup();
  await s.mk("Shopping");
  s.fake.queue(
    JSON.stringify({
      options: [
        { label: "Under Groceries", title: "Milk", parentId: "Groceries" },
        { label: "Under Shopping", title: "Milk", parentId: "Shopping" },
      ],
    }),
  );
  const res = await prepare(s.deps, {
    text: "add milk",
    actionId: "test.create",
    kind: "suggest",
  });
  expect(res).toMatchObject({
    status: "suggested",
    options: [{ label: "Under Shopping" }],
  });
  await s.close();
});

test("suggest fails not_found only when no option names anything", async () => {
  const s = await setup();
  s.fake.queue(
    JSON.stringify({
      options: [
        { label: "A", title: "Milk", parentId: "Nowhere" },
        { label: "B", title: "Milk", parentId: "Elsewhere" },
      ],
    }),
  );
  const err = await caught(
    prepare(s.deps, {
      text: "add milk",
      actionId: "test.create",
      kind: "suggest",
    }),
  );
  expect((err.cause as AiError).code).toBe("not_found");
  expect(err.message).toContain("Nowhere");
  await s.close();
});

test("suggest keeps each option's best match before an ambiguous one's others", async () => {
  const s = await setup();
  await s.mk("Groceries list");
  await s.mk("Groceries plan");
  await s.mk("Pantry");
  await s.mk("Fridge");
  s.fake.queue(
    JSON.stringify({
      options: [
        { label: "Groceries", title: "Milk", parentId: "Groceries" },
        { label: "Pantry", title: "Milk", parentId: "Pantry" },
        { label: "Fridge", title: "Milk", parentId: "Fridge" },
      ],
    }),
  );
  const res = await prepare(s.deps, {
    text: "add milk",
    actionId: "test.create",
    kind: "suggest",
  });
  if (res.status !== "suggested") throw new Error(res.status);
  // Three options: one Groceries match, then Pantry and Fridge, not a second Groceries.
  expect(res.options).toHaveLength(3);
  const labels = res.options.map((o) => o.label);
  expect(labels.filter((l) => l.includes("Groceries"))).toHaveLength(1);
  expect(labels.slice(1)).toEqual(["Pantry", "Fridge"]);
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
  expect(row.undo).toEqual({
    kind: "operation",
    operation: "test.create",
    token: { record: null, created: [made.id] },
  });
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
    /^Today is Mon, Nov 2, 2026, 16:00 \(America\/Los_Angeles\)\.\n<instruction>/,
  );
  await prepare(s.deps, { text: "find x", actionId: "test.find", kind: "ask" });
  expect(s.fake.calls[1]?.prompt).toMatch(/^<instruction>/);
  await s.close();
});

test("actions derived from operations pass collectAiRunners", async () => {
  const actions = moduleAiActions(testModule);
  expect(actions.map((a) => [a.id, a.kinds])).toEqual([
    ["test.relate", ["suggest", "do"]],
    ["test.create", ["suggest", "do"]],
    ["test.rename", ["suggest", "do"]],
    ["test.find", ["ask"]],
    ["test.poke", ["suggest", "do"]],
  ]);
  const { aiRunners } = collectServerModules(
    [testModule],
    [...CORE_ROUTER_IDS],
    { actions: [], runners: [] },
  );
  expect([...aiRunners.keys()]).toEqual([
    "test.relate",
    "test.create",
    "test.rename",
    "test.find",
    "test.poke",
  ]);
  const create = aiRunners.get("test.create");
  const doShape = create?.output.do as z.ZodObject;
  expect(doShape.safeParse({ title: "x", parentId: "Groceries" }).success).toBe(
    true,
  );
  expect(create?.output.suggest).toBeDefined();
  expect(aiRunners.get("test.find")?.output.ask).toBeDefined();
});

test("a hand-written runner's undo deletes what Core saw it create, never what its record lists", async () => {
  const s = await setup();
  const onScreen = await s.mk("On screen");
  s.fake.queue(JSON.stringify({ title: "Made" }));
  const res = await prepare(s.deps, {
    text: "make one",
    itemId: onScreen.id,
    actionId: "handmade",
    kind: "do",
  });
  expect(res.status).toBe("applied");
  const [made] = await s.db.select().from(items).where(eq(items.title, "Made"));
  if (!made) throw new Error("nothing created");
  s.tick();
  await undo(s.deps, { requestId: res.requestId });
  const deletedAt = async (id: string) =>
    (await s.db.select().from(items).where(eq(items.id, id)))[0]?.deletedAt;
  expect(await deletedAt(made.id)).not.toBeNull();
  expect(await deletedAt(onScreen.id)).toBeNull();
  expect((await rowOf(s.db, res.requestId)).status).toBe("undone");
  await s.close();
});

test("a query that throws ends the request failed", async () => {
  const s = await setup();
  s.fake.queue(
    JSON.stringify({ text: "missing" }),
    JSON.stringify({ text: "other" }),
  );
  const missing = await caught(
    prepare(s.deps, { text: "x", actionId: "broken.list", kind: "ask" }),
  );
  expect((missing.cause as AiError).code).toBe("not_found");
  const broken = await caught(
    prepare(s.deps, { text: "x", actionId: "broken.list", kind: "ask" }),
  );
  expect((broken.cause as AiError).code).toBe("internal");
  // The original error is kept for the server log.
  expect((broken.cause as AiError).cause).toBeInstanceOf(Error);
  expect(broken.message).toBe("The action failed on the server.");
  const rows = await s.db.select().from(aiRequests);
  expect(rows.map((r) => [r.status, r.errorCode])).toEqual([
    ["failed", "not_found"],
    ["failed", "internal"],
  ]);
  await s.close();
});

test("a runner's tools write only within its effects and the item on screen", async () => {
  const s = await setup();
  const a = await s.mk("Alpha");
  const b = await s.mk("Beta");
  const doIt = (actionId: string, other: string) => {
    s.fake.queue(JSON.stringify({ title: "Renamed", other }));
    return prepare(s.deps, {
      text: "rename",
      itemId: a.id,
      actionId,
      kind: "do",
    });
  };
  // Within its effects, on the item on screen: runs.
  expect(await doIt("renameHere", "")).toMatchObject({ status: "applied" });
  s.tick();
  // `updateItem` is not among its effects.
  const noEffect = await caught(doIt("renameCreating", ""));
  expect(noEffect.code).toBe("FORBIDDEN");
  // Another item than the one on screen.
  const other = await caught(doIt("renameHere", b.id));
  expect(other.code).toBe("FORBIDDEN");
  const rows = await s.db
    .select()
    .from(aiRequests)
    .where(eq(aiRequests.itemId, a.id));
  expect(rows.map((r) => r.status).sort()).toEqual([
    "applied",
    "failed",
    "failed",
  ]);
  expect((await getItem(s.db, b.id)).title).toBe("Beta");
  await s.close();
});

test("tools for a runner with no effects refuse every mutation", async () => {
  const s = await setup();
  const a = await s.mk("Alpha");
  const runner = defineAiRunner(
    describeAiAction({
      id: "askOnly",
      label: "Ask only",
      description: "Answers.",
      appliesTo: ["test"],
      kinds: ["ask"],
      effects: [],
    }),
    { context: itemContext, system: "", output: {} },
  );
  const op = testModule.operations.rename;
  if (op.kind !== "mutation") throw new Error("no rename");
  const err = await caught(
    writeItems(s.deps, (w) =>
      toolsFor(w, s.deps, runner, a.id).mutate(op, {
        id: a.id,
        expectedUpdatedAt: a.updatedAt,
        title: "Renamed",
      }),
    ),
  );
  expect(err.code).toBe("FORBIDDEN");
  expect((await getItem(s.db, a.id)).title).toBe("Alpha");
  await s.close();
});

test("an operation's subject must be the item on screen or one it names by title", async () => {
  const s = await setup();
  const a = await s.mk("Alpha");
  const b = await s.mk("Beta");
  // `otherId` is a plain id, not an item named by title: refused.
  s.fake.queue(JSON.stringify({ otherId: b.id }));
  const err = await caught(
    prepare(s.deps, {
      text: "poke beta",
      itemId: a.id,
      actionId: "test.poke",
      kind: "do",
    }),
  );
  expect(err.cause).toMatchObject({ code: "bad_output" });
  expect((await getItem(s.db, b.id)).title).toBe("Beta");
  await s.close();
});
