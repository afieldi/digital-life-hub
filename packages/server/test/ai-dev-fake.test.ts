import { describeOperation, fields } from "@dlh/core";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { coreAiRunners } from "../src/ai/core-runners";
import {
  devFakeAi,
  promptToday,
  scriptedFakeProvider,
} from "../src/ai/devFake";
import { operationAiRunner } from "../src/ai/operation-runner";
import { implementOperation } from "../src/operations/implement";

test("devFakeAi answers as OpenRouter with the fake model", () => {
  expect(devFakeAi).toMatchObject({
    defaultModel: "fake-model",
    providers: { openrouter: scriptedFakeProvider },
  });
});

describe("scriptedFakeProvider", () => {
  const signal = new AbortController().signal;
  const ask = (id: string, kind: "ask" | "suggest" | "do", prompt = "x") => {
    const runner = coreAiRunners.find((r) => r.action.id === id);
    const schema = runner?.output[kind];
    if (!schema) throw new Error(`no ${id} ${kind}`);
    return scriptedFakeProvider
      .complete({
        system: "",
        prompt,
        schema: z.toJSONSchema(schema) as object,
        model: "m",
        signal,
      })
      .then((r) => ({ raw: r.raw, schema }));
  };

  it.each([
    ["answer", "ask"],
    ["retitle", "suggest"],
    ["retitle", "do"],
    ["delete", "suggest"],
  ] as const)(
    "answers %s/%s with output its schema accepts",
    async (id, kind) => {
      const { raw, schema } = await ask(id, kind);
      expect(schema.safeParse(JSON.parse(raw)).success).toBe(true);
    },
  );

  it("returns non-JSON when the prompt contains [bad]", async () => {
    const { raw } = await ask("answer", "ask", "please [bad]");
    expect(() => JSON.parse(raw)).toThrow();
  });
});

describe("scriptedFakeProvider for operations", () => {
  const signal = new AbortController().signal;
  const versioned = { id: z.uuid(), expectedUpdatedAt: z.iso.datetime() };
  const ops = {
    create: describeOperation({
      id: "fake.create",
      kind: "mutation",
      label: "New",
      description: "Creates one.",
      appliesTo: ["*", "none"],
      input: z.object({
        title: z.string(),
        due: fields.due().optional(),
        priority: z.enum(["medium", "high"]).optional(),
        parentId: fields.item(["fake"]).optional(),
      }),
      subject: (i) => i.parentId ?? null,
      effects: ["createItems", "addLinks"],
      summary: () => "New",
    }),
    move: describeOperation({
      id: "fake.move",
      kind: "mutation",
      label: "Move",
      description: "Moves it.",
      appliesTo: ["fake"],
      input: z.object({
        ...versioned,
        position: z.enum(["top", "bottom"]),
        parentId: fields.item(["fake"]),
      }),
      subject: (i) => i.id,
      effects: ["updateItem"],
      summary: () => "Move",
    }),
    done: describeOperation({
      id: "fake.done",
      kind: "mutation",
      label: "Done",
      description: "Marks it done.",
      appliesTo: ["fake"],
      input: z.object(versioned),
      subject: (i) => i.id,
      effects: ["updateItem"],
      summary: () => "Done",
    }),
    due: describeOperation({
      id: "fake.due",
      kind: "query",
      label: "Due",
      description: "Lists what is due.",
      appliesTo: ["*", "none"],
      input: z.object({
        from: z.iso.date(),
        to: z.iso.date(),
        timeZone: z.string(),
      }),
      subject: () => null,
      effects: [],
      summary: () => "Due",
    }),
  };

  it.each([
    ["create", "do"],
    ["create", "suggest"],
    ["move", "do"],
    ["move", "suggest"],
    ["done", "do"],
    ["done", "suggest"],
    ["due", "ask"],
  ] as const)(
    "answers %s/%s with output its schema accepts",
    async (key, kind) => {
      const desc = ops[key];
      const op =
        desc.kind === "query"
          ? implementOperation(desc, { run: async () => null })
          : implementOperation(desc, {
              run: async () => ({ result: null, undo: null }),
              undo: async () => {},
              undoRecord: z.null(),
            });
      const schema = operationAiRunner(op).output[kind];
      if (!schema) throw new Error(`no ${key} ${kind}`);
      const { raw } = await scriptedFakeProvider.complete({
        system: "",
        prompt: "x",
        schema: z.toJSONSchema(schema) as object,
        model: "m",
        signal,
      });
      const parsed = schema.safeParse(JSON.parse(raw));
      expect(parsed.success).toBe(true);
      // One plain option, not Break down's checklist of titles.
      if (key === "done" && kind === "suggest") {
        expect(parsed.data).toEqual({ options: [{ label: "Fake option" }] });
      }
      if (key === "create" && kind === "do") {
        expect(Object.keys(parsed.data as object).sort()).toEqual([
          "due",
          "priority",
          "title",
        ]);
      }
    },
  );

  it.each([
    ["Fri, Nov 6, 2026", "2026-11-06", "2026-11-14"],
    ["Mon, Nov 2, 2026", "2026-11-02", "2026-11-10"],
    ["Thu, Dec 31, 2026", "2026-12-31", "2027-01-08"],
  ])(
    "fills a due range from the prompt's today (%s) through a week on",
    async (today, from, to) => {
      const { raw } = await scriptedFakeProvider.complete({
        system: "",
        prompt: `Today is ${today} (Europe/Warsaw).\n<instruction>\nwhat's due friday\n</instruction>`,
        schema: z.toJSONSchema(ops.due.input) as object,
        model: "m",
        signal,
      });
      expect(JSON.parse(raw)).toEqual({ from, to });
    },
  );
});

describe("promptToday", () => {
  it("reads the Today is line, or falls back to the UTC day", () => {
    expect(promptToday("Today is Fri, Nov 6, 2026 (UTC).").toISOString()).toBe(
      "2026-11-06T00:00:00.000Z",
    );
    expect(promptToday("no date here").toISOString().slice(0, 10)).toBe(
      new Date().toISOString().slice(0, 10),
    );
  });
});
