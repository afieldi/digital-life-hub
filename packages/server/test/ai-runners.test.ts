import { type AiActionDescription, describeAiAction } from "@dlh/core";
import { initTRPC } from "@trpc/server";
import { z } from "zod";
import {
  type AiRunner,
  CORE_ROUTER_IDS,
  collectAiRunners,
  collectServerModules,
  defineAiRunner,
  defineServerModule,
  suggestOptions,
} from "../src";
import type { ScopedWriter } from "../src/ai/scoped";

const desc = (
  id: string,
  appliesTo: AiActionDescription["appliesTo"] = "*",
): AiActionDescription =>
  describeAiAction({
    id,
    label: id,
    description: "does a thing",
    appliesTo,
    kinds: ["ask"],
    effects: [],
  });
const runner = (d: AiActionDescription): AiRunner =>
  defineAiRunner(d, {
    context: async () => ({ item: null, text: "", version: null }),
    system: "s",
    output: { ask: z.string() },
  });
const none = new Map<string, string>();

describe("collectAiRunners", () => {
  it("accepts a matching description and runner", () => {
    const d = desc("notes.tidy", ["note"]);
    const out = collectAiRunners(
      [d],
      [runner(d)],
      new Map([["notes.tidy", "notes"]]),
      new Map([["note", "notes"]]),
    );
    expect([...out.keys()]).toEqual(["notes.tidy"]);
  });

  it("accepts core actions with no prefix", () => {
    const d = desc("answer", ["*", "none"]);
    expect(collectAiRunners([d], [runner(d)], none, none).size).toBe(1);
  });

  it("rejects a module id without its module prefix", () => {
    const d = desc("tidy");
    expect(() =>
      collectAiRunners([d], [runner(d)], new Map([["tidy", "notes"]]), none),
    ).toThrow('AI action "tidy" must be prefixed with its module id "notes."');
  });

  it("rejects a description without a runner", () => {
    expect(() => collectAiRunners([desc("answer")], [], none, none)).toThrow(
      'AI action "answer" has no runner',
    );
  });

  it("rejects a runner without a description", () => {
    expect(() =>
      collectAiRunners([], [runner(desc("answer"))], none, none),
    ).toThrow('AI runner "answer" has no action description');
  });

  it("rejects duplicate ids", () => {
    const d = desc("answer");
    expect(() =>
      collectAiRunners([d], [runner(d), runner(d)], none, none),
    ).toThrow('Duplicate AI runner "answer"');
    expect(() => collectAiRunners([d, d], [runner(d)], none, none)).toThrow(
      'Duplicate AI action "answer"',
    );
  });

  it("rejects appliesTo naming a type no module owns", () => {
    const d = desc("notes.tidy", ["task"]);
    expect(() =>
      collectAiRunners(
        [d],
        [runner(d)],
        new Map([["notes.tidy", "notes"]]),
        new Map([["note", "notes"]]),
      ),
    ).toThrow('applies to item type "task" that no module owns');
  });

  it("accepts appliesTo naming another module's type", () => {
    const d = desc("notes.tidy", ["task"]);
    expect(() =>
      collectAiRunners(
        [d],
        [runner(d)],
        new Map([["notes.tidy", "notes"]]),
        new Map([["task", "tasks"]]),
      ),
    ).not.toThrow();
  });

  it("rejects a core action naming an item type", () => {
    const d = desc("answer", ["note"]);
    expect(() => collectAiRunners([d], [runner(d)], none, none)).toThrow(
      "may apply only to",
    );
  });
});

describe("collectServerModules with AI", () => {
  const router = initTRPC.create().router({});
  it("collects module and core runners", () => {
    const d = desc("notes.tidy", ["note"]);
    const c = desc("answer", "*");
    const mod = defineServerModule({
      id: "notes",
      itemTypes: ["note"],
      router,
      aiActions: [d],
      aiRunners: [runner(d)],
    });
    const { aiRunners } = collectServerModules([mod], [...CORE_ROUTER_IDS], {
      actions: [c],
      runners: [runner(c)],
    });
    expect([...aiRunners.keys()].sort()).toEqual(["answer", "notes.tidy"]);
  });

  it("reserves the ai router id", () => {
    expect(CORE_ROUTER_IDS).toContain("ai");
  });
});

describe("defineAiRunner", () => {
  const single = describeAiAction({
    id: "pick",
    label: "Pick",
    description: "Picks.",
    appliesTo: "*",
    kinds: ["suggest", "do"],
    effects: ["updateItem"],
  });
  const output = {
    do: z.object({ title: z.string() }),
    suggest: suggestOptions(z.object({ title: z.string() }), {
      min: 1,
      max: 3,
    }),
  };
  const w = {} as ScopedWriter;
  const tools = {} as never;

  it("types what apply gets from the output schemas and the action", () => {
    defineAiRunner(single, {
      context: async () => ({ item: null, text: "", version: null }),
      system: "s",
      output,
      async apply(_w, out) {
        expectTypeOf(out).toEqualTypeOf<{ title: string }>();
        return null;
      },
    });
    // No suggest schema: only do's output, not `unknown`.
    defineAiRunner(single, {
      context: async () => ({ item: null, text: "", version: null }),
      system: "s",
      output: { do: output.do },
      async apply(_w, out) {
        expectTypeOf(out).toEqualTypeOf<{ title: string }>();
        return null;
      },
    });
    const multi = describeAiAction({
      id: "picks",
      label: "Picks",
      description: "Picks several.",
      appliesTo: "*",
      kinds: ["suggest"],
      effects: ["updateItem"],
      multiSelect: true,
    });
    defineAiRunner(multi, {
      context: async () => ({ item: null, text: "", version: null }),
      system: "s",
      output,
      async apply(_w, out) {
        expectTypeOf(out).toEqualTypeOf<
          { title: string } | { title: string }[]
        >();
        return null;
      },
    });
  });

  it("parses the stored undo record before undo gets it", async () => {
    const got: unknown[] = [];
    const runner = defineAiRunner(single, {
      context: async () => ({ item: null, text: "", version: null }),
      system: "s",
      output,
      async apply() {
        return { id: "a", n: 1 };
      },
      undoRecord: z.object({ id: z.string(), n: z.coerce.number() }),
      async undo(_w, record) {
        expectTypeOf(record).toEqualTypeOf<{ id: string; n: number }>();
        got.push(record);
      },
    });
    await runner.undo?.(w, { id: "a", n: "2" }, tools);
    expect(got).toEqual([{ id: "a", n: 2 }]);
    await expect(runner.undo?.(w, { id: 1 }, tools)).rejects.toThrow();
    expect(got).toHaveLength(1);
  });

  it("suggestOptions refuses extra fields and the wrong count", () => {
    const shape = suggestOptions(z.object({ title: z.string() }), 2);
    expect(
      shape.safeParse({ options: [{ title: "a" }, { title: "b" }] }).success,
    ).toBe(true);
    expect(shape.safeParse({ options: [{ title: "a" }] }).success).toBe(false);
    expect(
      shape.safeParse({ options: [{ title: "a", x: 1 }, { title: "b" }] })
        .success,
    ).toBe(false);
  });
});
