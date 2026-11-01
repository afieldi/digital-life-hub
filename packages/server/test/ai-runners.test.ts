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
} from "../src";

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

  it("rejects appliesTo naming a type the module does not own", () => {
    const d = desc("notes.tidy", ["task"]);
    expect(() =>
      collectAiRunners(
        [d],
        [runner(d)],
        new Map([["notes.tidy", "notes"]]),
        new Map([["task", "tasks"]]),
      ),
    ).toThrow('applies to item type "task" that its module does not own');
  });

  it("rejects a core action naming an item type", () => {
    const d = desc("answer", ["note"]);
    expect(() => collectAiRunners([d], [runner(d)], none, none)).toThrow(
      "does not own",
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
