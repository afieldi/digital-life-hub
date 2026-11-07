import { type AiDecisionProvider, AiError } from "@dlh/server";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { agentRuns } from "../../agent/src/db/schema";
import { slackActions } from "../src/db/schema";
import type { HandleActionInput, HandleMessageInput } from "../src/schema";
import { setup } from "./setup";

/** Jev picks `slack.handOff`; the owner sends one DM. Plain fakes, not vi.fn. */
async function harness() {
  const s = await setup();
  const provider: AiDecisionProvider = {
    id: "vercel",
    async decide() {
      return {
        choice: "slack.handOff|do",
        confidence: 0.9,
        probabilities: { "slack.handOff|do": 0.9 },
      };
    },
    async complete() {
      throw new AiError("provider_unavailable", "The model is down");
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
  const send = async (text: string) =>
    (await s.slack.slack.handleMessage(message(text))).result;
  const act = async (input: HandleActionInput) =>
    (await s.slack.slack.handleAction(input)).result;
  const live = async (table: "items" | "agent_runs") =>
    Number(
      (
        await s.db.execute<{ n: string }>(
          table === "items"
            ? sql`select count(*) as n from items where deleted_at is null and type = 'task'`
            : sql`select count(*) as n from agent_runs`,
        )
      )[0]?.n,
    );
  return { ...s, send, act, live };
}

const input = (b: { value: string } | undefined): HandleActionInput =>
  JSON.parse(b?.value ?? "");

test("handOff files, assigns and offers Undo and Cancel run", async () => {
  const h = await harness();
  const out = await h.send("have the agent tidy the docs\nthanks");
  expect(out.reply).toBe("Given to the agent: have the agent tidy the docs");
  expect(out.buttons?.map((b) => b.label)).toEqual(["Undo", "Cancel run"]);

  const [row] = await h.db.select().from(slackActions);
  expect(row).toMatchObject({ operation: "agent.assignRequest" });
  expect(input(out.buttons?.[0])).toEqual({
    do: "undoAction",
    slackActionId: row?.id,
  });
  expect(input(out.buttons?.[1])).toEqual({
    do: "cancelRun",
    taskId: row?.runTaskId,
  });

  // Filed from you, as the DM, then resolved as the agent's task.
  const { rows } = await h.caller.requests.resolved({});
  const request = rows[0];
  expect(request).toMatchObject({
    source: "slack",
    sourceHandle: "UOWNER",
    fromOwner: true,
    externalId: "D9:1700000000.000001",
    sourceUrl: "https://example.slack.com/archives/D9/p1",
    outcome: "task",
  });
  const [run] = await h.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.taskId, row?.runTaskId ?? ""));
  expect(run?.status).toBe("queued");
  await h.close();
});

test("undo of a handoff before the claim deletes the run and the task", async () => {
  const h = await harness();
  const out = await h.send("have the agent tidy the docs");
  const undone = await h.act(input(out.buttons?.[0]));
  expect(undone.reply).toMatch(/^Undid /);
  expect(await h.live("agent_runs")).toBe(0);
  expect(await h.live("items")).toBe(0);
  const { items } = await h.caller.requests.open({});
  expect(items).toHaveLength(1);
  await h.close();
});

test("undo after the claim says Changed since and offers Cancel run", async () => {
  const h = await harness();
  const out = await h.send("have the agent tidy the docs");
  await h.db.update(agentRuns).set({ status: "running" });
  const undone = await h.act(input(out.buttons?.[0]));
  expect(undone.reply).toBe("Changed since");
  expect(undone.buttons?.map((b) => b.label)).toEqual(["Cancel run"]);
  expect(input(undone.buttons?.[0])).toEqual(input(out.buttons?.[1]));
  expect(await h.live("agent_runs")).toBe(1);
  await h.close();
});

test("a redelivered handoff replies Already handled", async () => {
  const h = await harness();
  await h.send("have the agent tidy the docs");
  const again = await h.send("have the agent tidy the docs");
  expect(again).toEqual({ reply: "Already handled." });
  expect(await h.live("agent_runs")).toBe(1);
  await h.close();
});

test("an assign failure leaves the request in the queue and says so", async () => {
  const h = await harness();
  // The run can't be queued, so assignRequest fails after the request is filed.
  await h.db.execute(sql`alter table agent_runs rename to agent_runs_gone`);
  const out = await h.send("have the agent tidy the docs");
  expect(out).toEqual({
    reply: "Filed it, but couldn't give it to the agent. It's in your queue.",
  });
  const { items } = await h.caller.requests.open({});
  expect(items.map((r) => r.title)).toEqual(["have the agent tidy the docs"]);
  await h.close();
});
