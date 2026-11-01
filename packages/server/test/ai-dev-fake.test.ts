import { describe, expect, it } from "vitest";
import { z } from "zod";
import { coreAiRunners } from "../src/ai/core-runners";
import { devFakeAi, scriptedFakeProvider } from "../src/ai/devFake";

describe("devFakeAi", () => {
  it("is on only for AI_FAKE_PROVIDER=1 in development", () => {
    expect(
      devFakeAi({ AI_FAKE_PROVIDER: "1", NODE_ENV: "development" }),
    ).toMatchObject({
      defaultModel: "fake-model",
    });
    expect(
      devFakeAi({ AI_FAKE_PROVIDER: "1", NODE_ENV: "production" }),
    ).toBeNull();
    expect(devFakeAi({ AI_FAKE_PROVIDER: "1" })).toBeNull();
    expect(devFakeAi({ NODE_ENV: "development" })).toBeNull();
    expect(
      devFakeAi({ AI_FAKE_PROVIDER: "0", NODE_ENV: "development" }),
    ).toBeNull();
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
