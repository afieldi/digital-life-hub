import type { AiDecisionProvider } from "@dlh/server";
import { expect, test } from "vitest";
import { interpretOwner } from "../src/server/owner/interpret";
import { setup } from "./setup";

type Answer = { choice: string; confidence?: number };
type Seen = Parameters<AiDecisionProvider["decide"]>[0];
type Script = {
  action: Answer;
  /** Chosen from the offered hits, so a test can name one by its title. */
  subject?: (hits: { value: string; description: string }[]) => Answer;
};

/** Answers each decision by its question's name; a plain fake, not vi.fn. */
async function harness(script: Script) {
  const s = await setup();
  const seen: Seen[] = [];
  const provider: AiDecisionProvider = {
    id: "vercel",
    async decide(req) {
      seen.push(req);
      const a =
        req.question.name === "subject"
          ? script.subject?.(req.question.choices)
          : script.action;
      if (!a) throw new Error(`unexpected ${req.question.name} question`);
      const confidence = a.confidence ?? 0.9;
      return {
        choice: a.choice,
        confidence,
        probabilities: { [a.choice]: confidence },
      };
    },
    async complete() {
      throw new Error("no completions here");
    },
  };
  s.deps.ai.providers.vercel = provider;
  const run = (text: string) =>
    interpretOwner(s.deps, {
      text,
      context: [],
      model: "typesafe-ai/jev",
      timeoutMs: 3000,
      threshold: 0.6,
    });
  return { ...s, seen, run };
}

async function seed(h: Awaited<ReturnType<typeof harness>>) {
  const task = await h.caller.tasks.create({
    title: "Chase Dana about the invoice",
  });
  const { request } = (
    await h.caller.requests.file({
      title: "Dana asks for the roadmap deck",
      body: "Could you send me the roadmap deck?",
      source: "slack",
      externalId: "D1:1.1",
      sourceUrl: "https://example.slack.com/archives/D1/p1",
      sourceHandle: "U1",
      fromName: "Dana",
    })
  ).result;
  return { taskId: task.result.id, requestId: request.id };
}

const byTitle =
  (title: string) => (hits: { value: string; description: string }[]) => {
    const hit = hits.find((c) => c.description.includes(title));
    if (!hit) throw new Error(`no hit for ${title}`);
    return { choice: hit.value };
  };

test("offers every action and kind, plus handOff, reply and escalate", async () => {
  const h = await harness({ action: { choice: "escalate" } });
  await h.run("what's due today?");
  const choices = h.seen[0]?.question.choices ?? [];
  const expected = [...h.deps.ai.runners.values()].flatMap((r) =>
    r.action.kinds.map((k) => `${r.action.id}|${k}`),
  );
  expect(choices.map((c) => c.value)).toEqual([
    ...expected,
    "slack.handOff|do",
    "slack.reply|do",
    "escalate",
  ]);
  const text = (v: string) => choices.find((c) => c.value === v)?.description;
  expect(text("tasks.due|ask")).toContain("Lists tasks due on a day");
  expect(text("tasks.due|ask")).toContain("answer only");
  expect(text("tasks.create|suggest")).toContain("offer options");
  expect(text("tasks.create|do")).toContain("do it");
  await h.close();
});

test("postToSource is not an AI action", async () => {
  const h = await harness({ action: { choice: "escalate" } });
  await h.run("post in the thread that it's done");
  expect(h.deps.ai.runners.has("slack.postToSource")).toBe(false);
  const choices = h.seen[0]?.question.choices ?? [];
  expect(choices.length).toBeGreaterThan(2);
  expect(
    choices.filter((c) => c.value.startsWith("slack.postToSource")),
  ).toEqual([]);
  await h.close();
});

test("an action that applies to none asks one question", async () => {
  const h = await harness({
    action: { choice: "test.note|do", confidence: 0.95 },
  });
  const create = h.deps.ai.runners.get("tasks.create");
  if (!create) throw new Error("no tasks.create runner");
  h.deps.ai.runners.set("test.note", {
    ...create,
    action: { ...create.action, id: "test.note", appliesTo: "none" },
  });
  const pick = await h.run("remind me to chase Dana Friday");
  expect(h.seen).toHaveLength(1);
  expect(h.seen[0]?.input).toContain(
    JSON.stringify("remind me to chase Dana Friday"),
  );
  expect(pick).toEqual({
    kind: "action",
    actionId: "test.note",
    aiKind: "do",
    subjectId: null,
    confidence: 0.95,
  });
  await h.close();
});

test("an item-or-none action can pick none without escalating", async () => {
  const h = await harness({
    action: { choice: "tasks.create|do" },
    subject: () => ({ choice: "none", confidence: 0.9 }),
  });
  await seed(h);
  const pick = await h.run("remind me to chase Dana Friday");
  expect(h.seen.map((r) => r.question.name)).toEqual(["action", "subject"]);
  expect(pick).toMatchObject({
    kind: "action",
    actionId: "tasks.create",
    subjectId: null,
  });
  await h.close();
});

test("an item-or-none action can pick an item", async () => {
  const h = await harness({
    action: { choice: "answer|ask" },
    subject: byTitle("Chase Dana"),
  });
  const { taskId } = await seed(h);
  const pick = await h.run("what's the Dana invoice task about?");
  expect(pick).toMatchObject({
    kind: "action",
    actionId: "answer",
    subjectId: taskId,
  });
  await h.close();
});

test("an action on items asks a second question over the search hits", async () => {
  const h = await harness({
    action: { choice: "retitle|do" },
    subject: byTitle("Chase Dana"),
  });
  const { taskId } = await seed(h);
  const pick = await h.run("rename the Dana invoice task");
  expect(h.seen.map((r) => r.question.name)).toEqual(["action", "subject"]);
  const values = h.seen[1]?.question.choices.map((c) => c.value) ?? [];
  expect(values).toContain(taskId);
  expect(values.at(-1)).toBe("none");
  expect(values.length).toBeLessThanOrEqual(6);
  expect(pick).toMatchObject({
    kind: "action",
    actionId: "retitle",
    aiKind: "do",
    subjectId: taskId,
  });
  await h.close();
});

test("handOff asks one question and picks no subject", async () => {
  const h = await harness({ action: { choice: "slack.handOff|do" } });
  const pick = await h.run("have the agent look into the Acme invoice");
  expect(h.seen).toHaveLength(1);
  expect(pick).toEqual({ kind: "handOff", subjectId: null, confidence: 0.9 });
  await h.close();
});

test("an unsure subject escalates", async () => {
  const h = await harness({
    action: { choice: "retitle|do" },
    subject: (hits) => ({
      choice: byTitle("Chase Dana")(hits).choice,
      confidence: 0.4,
    }),
  });
  await seed(h);
  expect(await h.run("rename the Dana invoice task")).toMatchObject({
    kind: "escalate",
  });
  await h.close();
});

test("a reply in words asks one question and needs no item", async () => {
  const h = await harness({
    action: { choice: "slack.reply|do", confidence: 0.9 },
  });
  await seed(h);
  expect(await h.run("thanks!")).toEqual({ kind: "reply", confidence: 0.9 });
  expect(h.seen).toHaveLength(1);
  await h.close();
});

test("an unsure reply escalates", async () => {
  const h = await harness({
    action: { choice: "slack.reply|do", confidence: 0.4 },
  });
  expect(await h.run("hmm")).toEqual({ kind: "escalate", confidence: 0.4 });
  await h.close();
});

test("an unsure action escalates", async () => {
  const h = await harness({
    action: { choice: "tasks.create|do", confidence: 0.3 },
  });
  const pick = await h.run("something vague");
  expect(h.seen).toHaveLength(1);
  expect(pick).toEqual({ kind: "escalate", confidence: 0.3 });
  await h.close();
});

test("no matching item escalates", async () => {
  const h = await harness({ action: { choice: "retitle|do" } });
  const pick = await h.run("rename the zebra project");
  expect(h.seen).toHaveLength(1);
  expect(pick).toMatchObject({ kind: "escalate" });
  await h.close();
});

test("a subject of none escalates", async () => {
  const h = await harness({
    action: { choice: "retitle|do" },
    subject: () => ({ choice: "none" }),
  });
  await seed(h);
  expect(await h.run("rename the Dana invoice task")).toMatchObject({
    kind: "escalate",
  });
  await h.close();
});

test("a choice outside the offered set is a bad_output error", async () => {
  const h = await harness({ action: { choice: "nope|do" } });
  await expect(h.run("anything")).rejects.toMatchObject({ code: "bad_output" });
  await h.close();
});

test("a long message still finds items that match only some of its words", async () => {
  const h = await harness({
    action: { choice: "retitle|do" },
    subject: byTitle("Chase Dana"),
  });
  const { taskId } = await seed(h);
  const pick = await h.run(
    "could you please rename that invoice task so it reads better for everybody",
  );
  const values = h.seen[1]?.question.choices.map((c) => c.value) ?? [];
  expect(values).toContain(taskId);
  expect(pick).toMatchObject({ kind: "action", subjectId: taskId });
  await h.close();
});
