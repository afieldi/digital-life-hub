import { describeOperation } from "@dlh/core";
import { items } from "@dlh/db";
import { TRPCError } from "@trpc/server";
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
  type ScopedWriter,
  writeItems,
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

const renameInput = z.object({
  id: z.uuid(),
  expectedUpdatedAt: z.iso.datetime(),
  title: z.string().min(1),
});

const renameDesc = describeOperation({
  id: "alpha.rename",
  kind: "mutation",
  label: "Rename",
  description: "Rename an item.",
  appliesTo: ["test"],
  input: renameInput,
  subject: (i) => i.id,
  effects: ["updateItem"],
  summary: (i) => `Rename to ${i.title}`,
});

const renameBothDesc = describeOperation({
  id: "beta.renameBoth",
  kind: "mutation",
  label: "Rename both",
  description: "Rename its subject, then another item through alpha.rename.",
  appliesTo: "none",
  input: z.object({
    id: z.uuid(),
    expectedUpdatedAt: z.iso.datetime(),
    title: z.string().min(1),
    other: z.uuid(),
    otherUpdatedAt: z.iso.datetime(),
    otherTitle: z.string().min(1),
    // A second call on the same item, so undo must run the last one first.
    otherThen: z.string().min(1).optional(),
  }),
  subject: (i) => i.id,
  effects: ["updateItem"],
  summary: () => "Rename both",
  calls: [renameDesc],
});

/** The title before, and the title the call set: undo reverts only if it still holds. */
const renameRecord = z.object({
  id: z.uuid(),
  title: z.string(),
  renamedTo: z.string(),
});

async function undoRename(
  w: ScopedWriter,
  record: z.infer<typeof renameRecord>,
) {
  const [now] = await w.tx
    .select({ title: items.title, updatedAt: items.updatedAt })
    .from(items)
    .where(eq(items.id, record.id));
  if (now?.title !== record.renamedTo) {
    throw new TRPCError({ code: "CONFLICT", message: "item changed" });
  }
  await w.updateItem?.({
    id: record.id,
    expectedUpdatedAt: now.updatedAt.toISOString(),
    title: record.title,
  });
}

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
    rename: implementOperation(renameDesc, {
      async run(w, input) {
        const [was] = await w.tx
          .select({ title: items.title })
          .from(items)
          .where(eq(items.id, input.id));
        const item = await w.updateItem?.(input);
        if (!item || !was) throw new Error("no writer");
        return {
          result: item,
          undo: { id: item.id, title: was.title, renamedTo: item.title },
        };
      },
      undo: undoRename,
      undoRecord: renameRecord,
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
    renameBoth: implementOperation(renameBothDesc, {
      async run(w, input) {
        if (!w.call) throw new Error("no call");
        const [was] = await w.tx
          .select({ title: items.title })
          .from(items)
          .where(eq(items.id, input.id));
        const item = await w.updateItem?.({
          id: input.id,
          expectedUpdatedAt: input.expectedUpdatedAt,
          title: input.title,
        });
        if (!item || !was) throw new Error("no writer");
        let version = input.otherUpdatedAt;
        for (const title of [input.otherTitle, input.otherThen ?? ""].filter(
          Boolean,
        )) {
          const out = (await w.call(renameDesc, {
            id: input.other,
            expectedUpdatedAt: version,
            title,
          })) as Created;
          version = out.updatedAt;
        }
        return {
          result: item,
          undo: { id: item.id, title: was.title, renamedTo: item.title },
        };
      },
      undo: undoRename,
      undoRecord: renameRecord,
    }),
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

async function seed(deps: CoreDeps, title: string) {
  return writeItems(deps, (w) => w.createItem({ type: "test", title }));
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

async function renameBoth(
  deps: CoreDeps,
  caller: Awaited<ReturnType<typeof setup>>["caller"],
  otherTitle: string,
  otherThen?: string,
) {
  const mine = await seed(deps, "mine");
  const other = await seed(deps, "A");
  const out = await caller.beta.renameBoth({
    id: mine.id,
    expectedUpdatedAt: mine.updatedAt,
    title: "mine, renamed",
    other: other.id,
    otherUpdatedAt: other.updatedAt,
    otherTitle,
    otherThen,
  });
  return { mine, other, out };
}

test("the callee's undo record is in the caller's token", async () => {
  const { deps, caller, close } = await setup();
  const { other, out } = await renameBoth(deps, caller, "B");
  expect(out.undo.calls).toEqual([
    {
      operation: "alpha.rename",
      record: { id: other.id, title: "A", renamedTo: "B" },
    },
  ]);
  await close();
});

test("ops.undo reverts the callee's update as well as the caller's", async () => {
  const { deps, caller, close } = await setup();
  const { mine, other, out } = await renameBoth(deps, caller, "B");
  expect((await row(deps, other.id))?.title).toBe("B");
  await caller.ops.undo({ id: "beta.renameBoth", token: out.undo });
  expect((await row(deps, mine.id))?.title).toBe("mine");
  expect((await row(deps, other.id))?.title).toBe("A");
  await close();
});

test("callee undos run after the caller's, last call first", async () => {
  const { deps, caller, close } = await setup();
  const { other, out } = await renameBoth(deps, caller, "B", "C");
  expect((await row(deps, other.id))?.title).toBe("C");
  await caller.ops.undo({ id: "beta.renameBoth", token: out.undo });
  // Reverting B's record first would conflict on C's version; ending at A needs C's first.
  expect((await row(deps, other.id))?.title).toBe("A");
  await close();
});

test("undo conflicts as a whole when the callee's item changed since", async () => {
  const { deps, caller, close } = await setup();
  const { mine, other, out } = await renameBoth(deps, caller, "B");
  const current = await row(deps, other.id);
  await caller.alpha.rename({
    id: other.id,
    expectedUpdatedAt: current?.updatedAt.toISOString() ?? "",
    title: "edited since",
  });
  await expect(
    caller.ops.undo({ id: "beta.renameBoth", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Changed since" });
  expect((await row(deps, mine.id))?.title).toBe("mine, renamed");
  expect((await row(deps, other.id))?.title).toBe("edited since");
  await close();
});

test("a token without calls still undoes", async () => {
  const { deps, caller, close } = await setup();
  const { mine, out } = await renameBoth(deps, caller, "B");
  const { calls: _calls, ...old } = out.undo;
  await caller.ops.undo({ id: "beta.renameBoth", token: old });
  expect((await row(deps, mine.id))?.title).toBe("mine");
  await close();
});
