import { initTRPC } from "@trpc/server";
import {
  CORE_ROUTER_IDS,
  collectServerModules,
  defineServerModule,
} from "../src";

const router = initTRPC.create().router({});
const mod = (id: string, itemTypes: string[] = []) =>
  defineServerModule({ id, itemTypes, router });
const reserved = [...CORE_ROUTER_IDS];

describe("collectServerModules", () => {
  it("rejects duplicate module ids", () => {
    expect(() => collectServerModules([mod("x"), mod("x")], reserved)).toThrow(
      'Duplicate server module id "x"',
    );
  });

  it("rejects an item type claimed twice", () => {
    expect(() =>
      collectServerModules([mod("a", ["note"]), mod("b", ["note"])], reserved),
    ).toThrow('Item type "note" is claimed by modules "a" and "b"');
  });

  it("rejects ids that clash with a core router", () => {
    expect(() => collectServerModules([mod("items")], reserved)).toThrow(
      'Module id "items" clashes with a core router',
    );
  });

  it("returns the union of item types", () => {
    const { modules, itemTypes } = collectServerModules(
      [mod("a", ["note", "memo"]), mod("b", ["task"])],
      reserved,
    );
    expect(modules).toHaveLength(2);
    expect([...itemTypes].sort()).toEqual(["memo", "note", "task"]);
  });
});
