import { type AiDecisionProvider, AiError } from "@dlh/server";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import type { HandleMessageInput } from "../src/schema";
import { HELP_REPLY } from "../src/server/owner/reply";
import { setup } from "./setup";

type Answer = { choice: string; confidence?: number };

/** Jev picks by question name; the gateway's model answers from a queue. Plain fakes, not vi.fn. */
async function harness(action: Answer | "fail") {
  const s = await setup();
  const completions: string[] = [];
  const provider: AiDecisionProvider = {
    id: "vercel",
    async decide(req) {
      if (action === "fail") {
        throw new AiError("provider_unavailable", "Jev is down");
      }
      if (req.question.name !== "action") {
        throw new Error(`unexpected ${req.question.name} question`);
      }
      const confidence = action.confidence ?? 0.9;
      return {
        choice: action.choice,
        confidence,
        probabilities: { [action.choice]: confidence },
      };
    },
    async complete() {
      const raw = completions.shift();
      if (raw === undefined) {
        throw new AiError("provider_unavailable", "The model is down");
      }
      return { raw };
    },
  };
  s.slackDeps.ai.providers.vercel = provider;
  await s.caller.slack.setSettings({ ownerSlackId: "UOWNER" });
  const message = (text: string): HandleMessageInput => ({
    event: {
      channel: "D9",
      ts: "1700000000.000001",
      text,
      permalink: "https://example.slack.com/archives/D9/p1",
      isDm: true,
    },
    sender: {
      slackUserId: "UOWNER",
      name: "Arek",
      githubLogin: null,
      isOwner: true,
    },
    context: [],
  });
  const send = (text: string) => s.slack.slack.handleMessage(message(text));
  const aiRows = async () =>
    await s.db.execute<{ origin: string; status: string }>(
      sql`select origin, status from ai_requests where status <> 'answered'`,
    );
  const taskTitles = async () =>
    (
      await s.db.execute<{ title: string }>(
        sql`select i.title from items i join tasks t on t.item_id = i.id where i.deleted_at is null`,
      )
    ).map((r) => r.title);
  return { ...s, completions, send, aiRows, taskTitles };
}

test("an owner Do runs through the gateway with origin slack and offers Undo", async () => {
  const h = await harness({ choice: "tasks.create|do" });
  h.completions.push(JSON.stringify({ title: "Chase Dana" }));
  const out = await h.send("add a task to chase Dana");
  expect(out.result.reply).toBe("Done: New task Chase Dana");
  const [undo] = out.result.buttons ?? [];
  expect(undo?.label).toBe("Undo");
  expect(JSON.parse(undo?.value ?? "")).toMatchObject({ do: "undo" });
  expect(await h.aiRows()).toEqual([{ origin: "slack", status: "applied" }]);
  expect(await h.taskTitles()).toEqual(["Chase Dana"]);
  await h.close();
});

test("an owner Ask replies with the answer", async () => {
  const h = await harness({ choice: "answer|ask" });
  h.completions.push(
    JSON.stringify({ answer: "Nothing is due today.", used: [] }),
  );
  const out = await h.send("what is due today?");
  expect(out.result).toEqual({ reply: "Nothing is due today." });
  await h.close();
});

test("an owner Suggest offers each option and None of these", async () => {
  const h = await harness({ choice: "tasks.create|suggest" });
  h.completions.push(
    JSON.stringify({
      options: [
        { label: "Chase Dana", title: "Chase Dana" },
        { label: "Call Dana", title: "Call Dana" },
      ],
    }),
  );
  const out = await h.send("maybe add a task about Dana");
  expect(out.result.reply).toBe("Pick one:");
  const buttons = out.result.buttons ?? [];
  expect(buttons.map((b) => b.label)).toEqual([
    "Chase Dana",
    "Call Dana",
    "None of these",
  ]);
  expect(buttons.map((b) => JSON.parse(b.value))).toMatchObject([
    { do: "apply", option: 0 },
    { do: "apply", option: 1 },
    { do: "discard" },
  ]);
  await h.close();
});

test("small talk gets a reply in words and files nothing", async () => {
  const h = await harness({ choice: "slack.reply|do" });
  h.completions.push(JSON.stringify({ reply: "Hi Arek!" }));
  const out = await h.send("hello");
  expect(out.result).toEqual({ reply: "Hi Arek!" });
  expect((await h.caller.requests.open({})).items).toEqual([]);
  expect(await h.taskTitles()).toEqual([]);
  await h.close();
});

test("a reply the model can't write is the help text, and files nothing", async () => {
  const h = await harness({ choice: "slack.reply|do" });
  const out = await h.send("hello");
  expect(out.result).toEqual({ reply: HELP_REPLY });
  expect((await h.caller.requests.open({})).items).toEqual([]);
  await h.close();
});

test("an owner message that is unsure escalates to the queue", async () => {
  const h = await harness({ choice: "escalate" });
  const out = await h.send("hmm\nsecond line");
  expect(out.result).toEqual({
    reply: "Not sure what you meant, so I put it in your queue.",
  });
  const { items } = await h.caller.requests.open({});
  expect(items.map((r) => r.title)).toEqual(["Bot wasn't sure: hmm"]);
  const { request } = await h.caller.requests.get({ id: items[0]?.id ?? "" });
  expect(request.actions).toBeNull();
  expect(request).toMatchObject({
    source: "slack",
    sourceHandle: "UOWNER",
    fromOwner: true,
  });
  await h.close();
});

test("the owner path writes nothing through the message's writer", async () => {
  const h = await harness({ choice: "tasks.create|do" });
  h.completions.push(JSON.stringify({ title: "Chase Dana" }));
  const out = await h.send("add a task to chase Dana");
  // The outer token is real and empty: nothing was created or called through its writer.
  expect(out.undo).toEqual({ record: null, created: [], calls: [] });
  expect(await h.taskTitles()).toEqual(["Chase Dana"]);
  await h.close();
});

test("a gateway failure replies with its message", async () => {
  const h = await harness({ choice: "tasks.create|do" });
  const out = await h.send("add a task to chase Dana");
  expect(out.result.reply).toBe("The model is down");
  expect(out.result.buttons).toBeUndefined();
  expect(await h.aiRows()).toEqual([{ origin: "slack", status: "failed" }]);
  await h.close();
});

test("Jev failing replies with its message", async () => {
  const h = await harness("fail");
  const out = await h.send("anything");
  expect(out.result.reply).toMatch(/\S/);
  await h.close();
});

test("a request only the app can run is cancelled, not left pending", async () => {
  const h = await harness({ choice: "tasks.create|do" });
  await h.db.execute(
    sql`insert into ai_settings (id, default_provider) values (1, 'claude-cli')
      on conflict (id) do update set default_provider = 'claude-cli'`,
  );
  const out = await h.send("add a task to chase Dana");
  expect(out.result).toEqual({ reply: "That needs the app to run." });
  expect(await h.aiRows()).toEqual([{ origin: "slack", status: "cancelled" }]);
  expect(await h.taskTitles()).toEqual([]);
  await h.close();
});
