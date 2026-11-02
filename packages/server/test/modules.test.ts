import { describeOperation } from "@dlh/core";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
  CORE_ROUTER_IDS,
  collectServerModules,
  defineServerModule,
  implementOperation,
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

  it("rejects an appliesTo type the module does not own", () => {
    const other = defineServerModule({ id: "b", itemTypes: ["task"], router });
    expect(() =>
      collectServerModules(
        [withOps("a", { peek: peek("a.peek", ["task"]) }), other],
        reserved,
        core,
      ),
    ).toThrow(
      'Operation "a.peek" applies to item type "task" that its module does not own',
    );
  });

  it("rejects a module with neither router nor operations", () => {
    expect(() =>
      collectServerModules([{ id: "a", itemTypes: [] }], reserved, core),
    ).toThrow('Module "a" has neither a router nor operations');
  });
});
