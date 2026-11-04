import { describeOperation } from "@dlh/core";
import { items } from "@dlh/db";
import { count, eq } from "drizzle-orm";
import { z } from "zod";
import {
  CORE_ROUTER_IDS,
  type CoreDeps,
  collectServerModules,
  coreRouters,
  defineServerModule,
  implementOperation,
  operationsRouter,
  router,
} from "../src";
import { freshTestDb, testDeps } from "../src/testing";

const createDesc = describeOperation({
  id: "alpha.create",
  kind: "mutation",
  label: "Create",
  description: "Create an item.",
  appliesTo: "none",
  input: z.object({ title: z.string().min(1) }),
  subject: () => null,
  effects: ["createItems"],
  summary: (i) => `Create ${i.title}`,
});

/** Writes outside its subject, which a caller's `writeOtherItems` must not excuse. */
const meddleDesc = describeOperation({
  id: "alpha.meddle",
  kind: "mutation",
  label: "Meddle",
  description: "Rename an item that is not its subject.",
  appliesTo: "none",
  input: z.object({ id: z.uuid(), expectedUpdatedAt: z.iso.datetime() }),
  subject: () => null,
  effects: ["updateItem"],
  summary: () => "Meddle",
});

const readDesc = describeOperation({
  id: "alpha.read",
  kind: "query",
  label: "Read",
  description: "Read an item's title.",
  appliesTo: ["test"],
  input: z.object({ id: z.uuid() }),
  subject: (i) => i.id,
  effects: [],
  summary: () => "Read",
});

const elsewhereDesc = describeOperation({
  id: "alpha.elsewhere",
  kind: "mutation",
  label: "Elsewhere",
  description: "Not declared by its caller.",
  appliesTo: "none",
  input: z.object({}),
  subject: () => null,
  effects: ["createItems"],
  summary: () => "Elsewhere",
});

const wrapDesc = describeOperation({
  id: "beta.wrap",
  kind: "mutation",
  label: "Wrap",
  description: "Create an item through alpha, then retitle it.",
  appliesTo: "none",
  input: z.object({
    title: z.string(),
    mode: z.enum(["ok", "fail", "undeclared", "bad", "meddle", "read"]),
  }),
  subject: () => null,
  effects: ["updateItem", "createItems", "writeOtherItems"],
  summary: () => "Wrap",
  calls: [createDesc, meddleDesc, readDesc],
});

type Created = { id: string; updatedAt: string };

const alpha = defineServerModule({
  id: "alpha",
  itemTypes: ["test"],
  operations: {
    create: implementOperation(createDesc, {
      async run(w, input) {
        const item = await w.createItem?.({ type: "test", title: input.title });
        if (!item) throw new Error("no writer");
        return { result: item, undo: null };
      },
      async undo() {},
      undoRecord: z.null(),
    }),
    meddle: implementOperation(meddleDesc, {
      async run(w, input) {
        const item = await w.updateItem?.({ ...input, title: "meddled" });
        return { result: item, undo: null };
      },
      async undo() {},
      undoRecord: z.null(),
    }),
    read: implementOperation(readDesc, {
      async run(deps, input) {
        const [row] = await deps.db
          .select({ title: items.title })
          .from(items)
          .where(eq(items.id, input.id));
        return row?.title ?? null;
      },
    }),
    elsewhere: implementOperation(elsewhereDesc, {
      async run() {
        return { result: null, undo: null };
      },
      async undo() {},
      undoRecord: z.null(),
    }),
  },
});

const beta = defineServerModule({
  id: "beta",
  itemTypes: [],
  operations: {
    wrap: implementOperation(wrapDesc, {
      async run(w, input) {
        if (!w.call) throw new Error("no call");
        if (input.mode === "undeclared") {
          // Not in `calls`, so Core refuses it.
          await w.call(elsewhereDesc, {});
        }
        const made = (await w.call(createDesc, {
          title: input.mode === "bad" ? "" : input.title,
        })) as Created;
        if (input.mode === "fail") throw new Error("after the call");
        if (input.mode === "meddle") {
          const other = await w.createItem?.({ type: "test", title: "other" });
          await w.call(meddleDesc, {
            id: other?.id ?? "",
            expectedUpdatedAt: other?.updatedAt ?? "",
          });
        }
        if (input.mode === "read") {
          // The callee's item is uncommitted, visible only inside this transaction.
          const title = await w.call(readDesc, { id: made.id });
          return { result: title, undo: made.id };
        }
        await w.updateItem?.({
          id: made.id,
          expectedUpdatedAt: made.updatedAt,
          title: `${input.title} (wrapped)`,
        });
        return { result: made.id, undo: made.id };
      },
      async undo() {},
      undoRecord: z.string(),
    }),
  },
});

const session = { id: "s", email: "arek@example.com" };

async function setup() {
  const { db, close } = await freshTestDb();
  const collected = collectServerModules([alpha, beta], [...CORE_ROUTER_IDS], {
    actions: [],
    runners: [],
  });
  const deps = testDeps(db, { operations: collected.operations });
  const caller = router({
    ...coreRouters,
    alpha: operationsRouter(alpha.operations),
    beta: operationsRouter(beta.operations),
  }).createCaller({
    deps,
    session,
    principal: { kind: "user", session },
  });
  return { db, deps, caller, close };
}

const row = async (deps: CoreDeps, id: string) =>
  (await deps.db.select().from(items).where(eq(items.id, id)))[0];

const itemCount = async (deps: CoreDeps) =>
  (await deps.db.select({ n: count() }).from(items))[0]?.n ?? 0;

test("the callee's created item is in the caller's undo token", async () => {
  const { deps, caller, close } = await setup();
  const out = await caller.beta.wrap({ title: "A", mode: "ok" });
  expect(out.undo.created).toEqual([out.result]);
  expect((await row(deps, out.result as string))?.title).toBe("A (wrapped)");
  await close();
});

test("ops.undo of the caller soft-deletes the callee's item", async () => {
  const { deps, caller, close } = await setup();
  const out = await caller.beta.wrap({ title: "A", mode: "ok" });
  await caller.ops.undo({ id: "beta.wrap", token: out.undo });
  expect((await row(deps, out.result as string))?.deletedAt).not.toBeNull();
  await close();
});

test("a failure after the call rolls back the callee's write", async () => {
  const { deps, caller, close } = await setup();
  const before = await itemCount(deps);
  await expect(caller.beta.wrap({ title: "A", mode: "fail" })).rejects.toThrow(
    "after the call",
  );
  expect(await itemCount(deps)).toBe(before);
  await close();
});

test("the callee's input schema is applied", async () => {
  const { deps, caller, close } = await setup();
  const before = await itemCount(deps);
  await expect(
    caller.beta.wrap({ title: "A", mode: "bad" }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect(await itemCount(deps)).toBe(before);
  await close();
});

test("the callee's effects bind, not the caller's", async () => {
  const { deps, caller, close } = await setup();
  const before = await itemCount(deps);
  // beta.wrap declares writeOtherItems, but alpha.meddle's subject is null.
  await expect(
    caller.beta.wrap({ title: "A", mode: "meddle" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await itemCount(deps)).toBe(before);
  await close();
});

test("calling an undeclared operation is FORBIDDEN", async () => {
  const { caller, close } = await setup();
  await expect(
    caller.beta.wrap({ title: "A", mode: "undeclared" }),
  ).rejects.toMatchObject({
    code: "FORBIDDEN",
    message: "Call outside the declared calls",
  });
  await close();
});

test("a called query sees the caller's uncommitted write", async () => {
  const { deps, caller, close } = await setup();
  const out = await caller.beta.wrap({ title: "A", mode: "read" });
  expect(out.result).toBe("A");
  expect((await row(deps, out.undo.record as string))?.title).toBe("A");
  await close();
});
