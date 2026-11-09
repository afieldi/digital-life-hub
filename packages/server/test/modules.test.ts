import { describeModule, describeOperation } from "@dlh/core";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
  CORE_ROUTER_IDS,
  collectServerModules,
  defineServerModule,
  implementOperation,
  type Operations,
  ServerModuleError,
  UNGUARDED_CALLS,
} from "../src";

const router = initTRPC.create().router({});
const mod = (id: string, itemTypes: string[] = []) =>
  defineServerModule({ id, itemTypes, router });
const reserved = [...CORE_ROUTER_IDS];
const core = { actions: [], runners: [] };

describe("collectServerModules", () => {
  it("rejects duplicate module ids", () => {
    expect(() =>
      collectServerModules([mod("x"), mod("x")], reserved, core),
    ).toThrow('Duplicate server module id "x"');
  });

  it("rejects an item type claimed twice", () => {
    expect(() =>
      collectServerModules(
        [mod("a", ["note"]), mod("b", ["note"])],
        reserved,
        core,
      ),
    ).toThrow('Item type "note" is claimed by modules "a" and "b"');
  });

  it("rejects ids that clash with a core router", () => {
    expect(() => collectServerModules([mod("items")], reserved, core)).toThrow(
      'Module id "items" clashes with a core router',
    );
  });

  it("returns the union of item types", () => {
    const { modules, itemTypes } = collectServerModules(
      [mod("a", ["note", "memo"]), mod("b", ["task"])],
      reserved,
      core,
    );
    expect(modules).toHaveLength(2);
    expect([...itemTypes].sort()).toEqual(["memo", "note", "task"]);
  });
});

describe("collectServerModules deleteWith", () => {
  it("maps deleteWith to every item type of its module", () => {
    const hook = async () => [];
    const { deleteWith } = collectServerModules(
      [
        defineServerModule({
          id: "a",
          itemTypes: ["task", "subtask"],
          router,
          deleteWith: hook,
        }),
        mod("b", ["note"]),
      ],
      reserved,
      core,
    );
    expect([...deleteWith.keys()].sort()).toEqual(["subtask", "task"]);
    expect(deleteWith.get("task")).toBe(hook);
    expect(deleteWith.get("subtask")).toBe(hook);
  });
});

describe("collectServerModules operations", () => {
  const peek = (id: string, appliesTo: string[] = ["note"]) =>
    implementOperation(
      describeOperation({
        id,
        kind: "query",
        label: "Peek",
        description: "Peek.",
        appliesTo,
        input: z.object({}),
        subject: () => null,
        effects: [],
        summary: () => "Peek",
      }),
      { run: async () => null },
    );
  const withOps = (
    id: string,
    operations: Record<string, ReturnType<typeof peek>>,
  ) => defineServerModule({ id, itemTypes: ["note"], operations });

  it("maps operations by id", () => {
    const op = peek("a.peek");
    const { operations } = collectServerModules(
      [withOps("a", { peek: op })],
      reserved,
      core,
    );
    expect([...operations.keys()]).toEqual(["a.peek"]);
    expect(operations.get("a.peek")).toBe(op);
  });

  it("rejects an id without the module prefix", () => {
    expect(() =>
      collectServerModules(
        [withOps("a", { peek: peek("b.peek") })],
        reserved,
        core,
      ),
    ).toThrow('Operation "b.peek" must be prefixed with its module id "a."');
  });

  it("rejects an id that does not match its key", () => {
    expect(() =>
      collectServerModules(
        [withOps("a", { look: peek("a.peek") })],
        reserved,
        core,
      ),
    ).toThrow('Operation "a.peek" is mounted as "a.look"');
  });

  it("rejects an appliesTo type no module owns", () => {
    expect(() =>
      collectServerModules(
        [withOps("a", { peek: peek("a.peek", ["task"]) })],
        reserved,
        core,
      ),
    ).toThrow(
      'Operation "a.peek" applies to item type "task" that no module owns',
    );
  });

  it("accepts an appliesTo type another module owns", () => {
    const other = defineServerModule({ id: "b", itemTypes: ["task"], router });
    expect(() =>
      collectServerModules(
        [withOps("a", { peek: peek("a.peek", ["task"]) }), other],
        reserved,
        core,
      ),
    ).not.toThrow();
  });

  describe("calls", () => {
    const desc = (
      id: string,
      kind: "query" | "mutation",
      calls?: ReturnType<typeof describeOperation>[],
      access?: "everyone" | "user",
    ) =>
      describeOperation({
        ...(access ? { access } : {}),
        id,
        kind,
        label: "Op",
        description: "Op.",
        appliesTo: "none",
        input: z.object({}),
        subject: () => null,
        effects: kind === "mutation" ? ["createItems"] : [],
        summary: () => "Op",
        ...(calls ? { calls } : {}),
      });
    const mutation = (d: ReturnType<typeof desc>) =>
      implementOperation(d, {
        run: async () => ({ result: null, undo: null }),
        undo: async () => {},
        undoRecord: z.null(),
      });
    const query = (d: ReturnType<typeof desc>) =>
      implementOperation(d, { run: async () => null });

    const owned = (id: string, operations: Operations) =>
      defineServerModule({ id, itemTypes: [], operations });

    const callee = desc("b.make", "mutation");

    it("registration refuses a call to an unregistered operation", () => {
      const caller = desc("a.wrap", "mutation", [callee]);
      expect(() =>
        collectServerModules(
          [owned("a", { wrap: mutation(caller) })],
          reserved,
          core,
        ),
      ).toThrow('Operation "a.wrap" calls "b.make", which is not registered');
    });

    it("registration refuses a self-call", () => {
      const self: ReturnType<typeof desc> = desc("a.wrap", "mutation");
      self.calls = [self];
      expect(() =>
        collectServerModules(
          [owned("a", { wrap: mutation(self) })],
          reserved,
          core,
        ),
      ).toThrow('Operation "a.wrap" calls itself');
    });

    it("registration refuses a nested call", () => {
      const inner = desc("c.deep", "mutation");
      const middle = desc("b.make", "mutation", [inner]);
      const outer = desc("a.wrap", "mutation", [middle]);
      expect(() =>
        collectServerModules(
          [
            owned("a", { wrap: mutation(outer) }),
            owned("b", { make: mutation(middle) }),
            owned("c", { deep: mutation(inner) }),
          ],
          reserved,
          core,
        ),
      ).toThrow(
        'Operation "a.wrap" calls "b.make", which makes calls of its own',
      );
    });

    it("an operation a run can call calls only what a run can, unless listed", () => {
      const yours = desc("b.read", "query", undefined, "user");
      const open = desc("b.open", "query", undefined, "everyone");
      const compose = (caller: ReturnType<typeof desc>) =>
        collectServerModules(
          [
            owned("a", { wrap: mutation(caller) }),
            owned("b", { read: query(yours), open: query(open) }),
          ],
          reserved,
          core,
        );
      // A run's call isn't guarded again inside: the callee would be reached unchecked.
      expect(() =>
        compose(desc("a.wrap", "mutation", [open, yours], "everyone")),
      ).toThrow(
        'Operation "a.wrap" can be called by a run, so it may call only operations a run can call, but calls "b.read". List it in UNGUARDED_CALLS if that is safe',
      );
      expect(() =>
        compose(desc("a.wrap", "mutation", [open], "everyone")),
      ).not.toThrow();
      // Only you can call it: its calls are yours to make.
      expect(() =>
        compose(desc("a.wrap", "mutation", [yours], "user")),
      ).not.toThrow();
    });

    it("a listed call from an operation a run can call is allowed", () => {
      const runSource = desc("agent.runSource", "query", undefined, "user");
      const post = desc(
        "slack.postToSource",
        "mutation",
        [runSource],
        "everyone",
      );
      expect(() =>
        collectServerModules(
          [
            owned("slack", { postToSource: mutation(post) }),
            owned("agent", { runSource: query(runSource) }),
          ],
          reserved,
          core,
          new Set(["slack.postToSource -> agent.runSource"]),
        ),
      ).not.toThrow();
    });

    it("a listed call that needs no listing is refused, so the list can't go stale", () => {
      const yours = desc("b.read", "query", undefined, "user");
      const open = desc("b.open", "query", undefined, "everyone");
      const compose = (caller: ReturnType<typeof desc>, listed: string) =>
        collectServerModules(
          [
            owned("a", { wrap: mutation(caller) }),
            owned("b", { read: query(yours), open: query(open) }),
          ],
          reserved,
          core,
          new Set([listed]),
        );
      const stale = (pair: string) =>
        `UNGUARDED_CALLS lists "${pair}", which is not a call a run could make unguarded: remove it`;
      // The callee is one a run can call.
      expect(() =>
        compose(
          desc("a.wrap", "mutation", [open], "everyone"),
          "a.wrap -> b.open",
        ),
      ).toThrow(stale("a.wrap -> b.open"));
      // The caller is only yours.
      expect(() =>
        compose(
          desc("a.wrap", "mutation", [yours], "user"),
          "a.wrap -> b.read",
        ),
      ).toThrow(stale("a.wrap -> b.read"));
      // The caller doesn't make that call.
      expect(() =>
        compose(
          desc("a.wrap", "mutation", [open], "everyone"),
          "a.wrap -> b.read",
        ),
      ).toThrow(stale("a.wrap -> b.read"));
      // A caller that isn't composed here is left to the app's own check.
      expect(() =>
        compose(
          desc("a.wrap", "mutation", [open], "everyone"),
          "z.gone -> b.read",
        ),
      ).not.toThrow();
    });

    it("the real list names only real violations", () => {
      expect([...UNGUARDED_CALLS].sort()).toEqual([
        "slack.postToSource -> agent.runSource",
        "slack.postToSource -> requests.get",
      ]);
    });

    it("registration accepts a call to a query", () => {
      const read = desc("b.read", "query");
      const caller = desc("a.wrap", "mutation", [read]);
      const { operations } = collectServerModules(
        [
          owned("a", { wrap: mutation(caller) }),
          owned("b", { read: query(read) }),
        ],
        reserved,
        core,
      );
      expect([...operations.keys()].sort()).toEqual(["a.wrap", "b.read"]);
    });
  });

  it("rejects a module with neither router nor operations", () => {
    expect(() =>
      collectServerModules([{ id: "a", itemTypes: [] }], reserved, core),
    ).toThrow('Module "a" has neither a router nor operations');
  });
});

describe("defineServerModule with a description", () => {
  const op = (id: string) =>
    describeOperation({
      id,
      kind: "query",
      label: "Peek",
      description: "Peeks.",
      appliesTo: ["*"],
      input: z.object({}),
      subject: () => null,
      effects: [],
      summary: () => "Peek",
    });
  const peek = op("demo.peek");
  const desc = describeModule({
    id: "demo",
    itemTypes: ["demo"],
    operations: { peek },
  });
  const impl = (d: typeof peek) =>
    implementOperation(d, { run: async () => 1 });

  it("takes id, item types and AI actions from the description", () => {
    const m = defineServerModule(desc, { operations: { peek: impl(peek) } });
    expect(m).toMatchObject({ id: "demo", itemTypes: ["demo"], aiActions: [] });
  });

  it("refuses an implementation for another operation than described", () => {
    expect(() =>
      defineServerModule(desc, { operations: { peek: impl(op("demo.peek")) } }),
    ).toThrow(ServerModuleError);
  });

  it("refuses a missing or extra implementation", () => {
    expect(() =>
      // @ts-expect-error: `peek` is described but not implemented
      defineServerModule(desc, { operations: {} }),
    ).toThrow(ServerModuleError);
  });
});

describe("describeModule", () => {
  it("refuses an operation mounted under a key its id doesn't name", () =>
    expect(() =>
      describeModule({
        id: "demo",
        itemTypes: [],
        operations: {
          look: describeOperation({
            id: "demo.peek",
            kind: "query",
            label: "Peek",
            description: "Peeks.",
            appliesTo: ["*"],
            input: z.object({}),
            subject: () => null,
            effects: [],
            summary: () => "Peek",
          }),
        },
      }),
    ).toThrow(/must be "demo.look"/));
});
