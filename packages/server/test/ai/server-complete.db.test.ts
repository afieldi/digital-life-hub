import { aiRequests } from "@dlh/db";
import { z } from "zod";
import {
  type AiDecisionProvider,
  AiError,
  type AiProvider,
  completeOnServer,
  decideOnServer,
  prepare,
  writeItems,
} from "../../src";
import { FakeProvider, freshTestDb, testDeps } from "../../src/testing";

const SHAPE = z.object({ intent: z.string() });

async function setup(opts: Parameters<typeof testDeps>[1] = {}) {
  const { db, close } = await freshTestDb();
  return { db, deps: testDeps(db, { itemTypes: ["test"], ...opts }), close };
}

async function rows(db: Awaited<ReturnType<typeof setup>>["db"]) {
  return db.select().from(aiRequests);
}

const REQ = {
  purpose: "slack.interpret",
  system: "You interpret.",
  prompt: "hello",
  schema: SHAPE,
};

test("completeOnServer returns the parsed value and logs one slack row", async () => {
  const fake = new FakeProvider("vercel");
  fake.queue({
    raw: JSON.stringify({ intent: "add" }),
    usage: { input: 10, output: 5, costUsd: 0.001 },
  });
  const s = await setup({
    ai: { providers: { vercel: fake }, defaultModels: { vercel: "gw-model" } },
  });
  const out = await completeOnServer(s.deps, REQ);
  expect(out.value).toEqual({ intent: "add" });
  const all = await rows(s.db);
  expect(all).toHaveLength(1);
  const [row] = all;
  expect(row?.id).toBe(out.requestId);
  expect(row?.origin).toBe("slack");
  expect(row?.actionId).toBe("slack.interpret");
  expect(row?.kind).toBe("ask");
  expect(row?.status).toBe("answered");
  expect(row?.provider).toBe("vercel");
  expect(row?.model).toBe("gw-model");
  expect(row?.inputTokens).toBe(10);
  expect(row?.outputTokens).toBe(5);
  expect(row?.durationMs).not.toBeNull();
  await s.close();
});

test("an answer that fails the schema is bad_output and logged failed", async () => {
  const fake = new FakeProvider("vercel");
  fake.queue(JSON.stringify({ wrong: 1 }));
  const s = await setup({
    ai: { providers: { vercel: fake }, defaultModels: { vercel: "m" } },
  });
  await expect(completeOnServer(s.deps, REQ)).rejects.toMatchObject({
    code: "bad_output",
  });
  const [row] = await rows(s.db);
  expect(row?.status).toBe("failed");
  expect(row?.errorCode).toBe("bad_output");
  expect(row?.origin).toBe("slack");
  await s.close();
});

test("no server provider is provider_unavailable", async () => {
  const s = await setup({ ai: { providers: {}, defaultModels: {} } });
  const e = await completeOnServer(s.deps, REQ).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(AiError);
  expect((e as AiError).code).toBe("provider_unavailable");
  await s.close();
});

test("existing gateway requests log origin app", async () => {
  const s = await setup();
  const item = await writeItems(s.deps, (w) =>
    w.createItem({ type: "test", title: "Old" }),
  );
  s.deps.fakeProvider.queue(JSON.stringify({ answer: "hi", used: [] }));
  await prepare(s.deps, {
    text: "hi",
    itemId: item.id,
    actionId: "answer",
    kind: "ask",
  });
  const all = await rows(s.db);
  expect(all).toHaveLength(1);
  expect(all[0]?.origin).toBe("app");
  await s.close();
});

const QUESTION = {
  name: "intent",
  instructions: "Pick.",
  choices: [
    { value: "add", description: "Add" },
    { value: "ask", description: "Ask" },
  ],
};

function decider(): AiDecisionProvider & { decided: number } {
  const base = new FakeProvider("vercel");
  const self = {
    ...base,
    id: "vercel" as const,
    decided: 0,
    complete: base.complete.bind(base),
    async decide() {
      self.decided++;
      return {
        choice: "add",
        confidence: 0.9,
        probabilities: { add: 0.9, ask: 0.1 },
        usage: { input: 7, output: 1, costUsd: 0.0002 },
      };
    },
  };
  return self;
}

test("decideOnServer returns the choice and confidence and logs one slack row", async () => {
  const vercel = decider();
  const s = await setup({
    ai: { providers: { vercel }, defaultModels: {} },
  });
  const out = await decideOnServer(s.deps, {
    purpose: "slack.interpret",
    question: QUESTION,
    input: "add milk",
    model: "luna",
  });
  expect(out).toMatchObject({ choice: "add", confidence: 0.9 });
  const all = await rows(s.db);
  expect(all).toHaveLength(1);
  const [row] = all;
  expect(row?.id).toBe(out.requestId);
  expect(row?.origin).toBe("slack");
  expect(row?.actionId).toBe("slack.interpret");
  expect(row?.provider).toBe("vercel");
  expect(row?.model).toBe("luna");
  expect(row?.status).toBe("answered");
  expect(row?.inputTokens).toBe(7);
  await s.close();
});

test("decideOnServer without the Gateway is provider_unavailable", async () => {
  const s = await setup({
    ai: {
      providers: { openrouter: new FakeProvider("openrouter") },
      defaultModels: {},
    },
  });
  const e = await decideOnServer(s.deps, {
    purpose: "slack.interpret",
    question: QUESTION,
    input: "x",
    model: "luna",
  }).catch((x: unknown) => x);
  expect(e).toBeInstanceOf(AiError);
  expect((e as AiError).code).toBe("provider_unavailable");
  await s.close();
});

/** Rejects with a plain error when its signal aborts, like a provider's fetch. */
const abortable = (signal: AbortSignal) =>
  new Promise<never>((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")));
  });

test("completeOnServer maps its own timeout to timeout", async () => {
  const hang: AiProvider = {
    id: "vercel",
    complete: (req) => abortable(req.signal),
  };
  const s = await setup({
    ai: { providers: { vercel: hang }, defaultModels: { vercel: "m" } },
  });
  await expect(
    completeOnServer(s.deps, { ...REQ, timeoutMs: 5 }),
  ).rejects.toMatchObject({ code: "timeout" });
  const [row] = await rows(s.db);
  expect(row?.status).toBe("failed");
  expect(row?.errorCode).toBe("timeout");
  await s.close();
});

test("decideOnServer maps its own timeout to timeout", async () => {
  const hang: AiDecisionProvider = {
    id: "vercel",
    complete: (req) => abortable(req.signal),
    decide: (req) => abortable(req.signal),
  };
  const s = await setup({
    ai: { providers: { vercel: hang }, defaultModels: {} },
  });
  await expect(
    decideOnServer(s.deps, {
      purpose: "slack.interpret",
      question: QUESTION,
      input: "x",
      model: "luna",
      timeoutMs: 5,
    }),
  ).rejects.toMatchObject({ code: "timeout" });
  const [row] = await rows(s.db);
  expect(row?.errorCode).toBe("timeout");
  await s.close();
});
