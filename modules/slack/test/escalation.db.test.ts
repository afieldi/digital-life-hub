import { type AiDecisionProvider, AiError } from "@dlh/server";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { setup } from "./setup";

/** Jev picks `escalate` for every message; the model replies with `replies`. */
async function harness(replies: string[] = []) {
  const s = await setup();
  const provider: AiDecisionProvider = {
    id: "vercel",
    async decide() {
      return {
        choice: "escalate",
        confidence: 0.95,
        probabilities: { escalate: 0.95 },
      };
    },
    async complete() {
      const reply = replies.shift();
      if (reply === undefined) throw new AiError("provider_unavailable", "x");
      return { raw: JSON.stringify({ reply }) };
    },
  };
  s.slackDeps.ai.providers.vercel = provider;
  s.deps.ai.providers.vercel = provider;
  await s.caller.slack.setSettings({ ownerSlackId: "UOWNER" });
  const escalate = async (text: string, ts = "1700000000.000001") => {
    const { result } = await s.slack.slack.handleMessage({
      event: {
        channel: "D1",
        ts,
        text,
        permalink: `https://example.slack.com/archives/D1/p${ts}`,
        isDm: true,
      },
      sender: {
        slackUserId: "U1",
        name: "Dana",
        githubLogin: null,
        isOwner: false,
      },
      context: [],
    });
    const id = result.filedRequestId as string;
    return { id, request: (await s.caller.requests.get({ id })).request };
  };
  const outbox = () =>
    s.db.execute<{
      key: string;
      origin: string;
      as: string;
      status: string;
      channel_id: string;
      thread_ts: string | null;
      text: string;
      request_id: string | null;
    }>(
      sql`select key, origin, "as", status, channel_id, thread_ts, text, request_id from slack_outbox order by key`,
    );
  return { ...s, escalate, outbox };
}

test("an escalation carries two candidates and Neither", async () => {
  const h = await harness();
  const { id, request } = await h.escalate("what is going on");
  expect(request.actions).toEqual([
    {
      label: "Pass on as a request",
      operation: "slack.runEscalated",
      input: { requestId: id, command: "leaveRequest" },
    },
    {
      label: "Reply with their status",
      operation: "slack.runEscalated",
      input: { requestId: id, command: "requestStatus" },
    },
    {
      label: "Neither",
      operation: "slack.dismissEscalation",
      input: { requestId: id },
    },
  ]);
  await h.close();
});

test("runEscalated runs the command, resolves handled and queues one approved outbox reply", async () => {
  const h = await harness(["Your request is still open."]);
  const { id } = await h.escalate("did you see it?", "1700000000.000009");
  const out = await h.caller.slack.runEscalated({
    requestId: id,
    command: "requestStatus",
  });
  expect(out.result).toEqual({ reply: "Your request is still open." });
  const { request } = await h.caller.requests.get({ id });
  expect(request.outcome).toBe("handled");
  expect(await h.outbox()).toEqual([
    {
      key: `escalation:${id}`,
      origin: "escalation",
      as: "bot",
      status: "approved",
      channel_id: "D1",
      thread_ts: "1700000000.000009",
      text: "Your request is still open.",
      request_id: id,
    },
  ]);
  await h.close();
});

test("runEscalated twice queues one reply", async () => {
  const h = await harness(["Still open.", "Second"]);
  const { id } = await h.escalate("status?");
  await h.caller.slack.runEscalated({
    requestId: id,
    command: "requestStatus",
  });
  const again = await h.caller.slack.runEscalated({
    requestId: id,
    command: "requestStatus",
  });
  expect(again.result).toEqual({ reply: "Still open." });
  expect(await h.outbox()).toHaveLength(1);
  await h.close();
});

test("undo of runEscalated before sending reopens the request and removes the reply", async () => {
  const h = await harness(["Still open."]);
  const { id } = await h.escalate("status?");
  const out = await h.caller.slack.runEscalated({
    requestId: id,
    command: "requestStatus",
  });
  await h.caller.ops.undo({ id: "slack.runEscalated", token: out.undo });
  expect((await h.caller.requests.get({ id })).request.outcome).toBeNull();
  expect(await h.outbox()).toHaveLength(0);
  await h.close();
});

test("undo after the reply was sent conflicts and changes nothing", async () => {
  const h = await harness(["Still open."]);
  const { id } = await h.escalate("status?");
  const out = await h.caller.slack.runEscalated({
    requestId: id,
    command: "requestStatus",
  });
  await h.db.execute(sql`update slack_outbox set status = 'sent'`);
  await expect(
    h.caller.ops.undo({ id: "slack.runEscalated", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await h.caller.requests.get({ id })).request.outcome).toBe("handled");
  expect(await h.outbox()).toHaveLength(1);
  await h.close();
});

test("passing on as a request replies with the ack", async () => {
  const h = await harness();
  const { id } = await h.escalate("can you look at this", "1700000000.000003");
  const out = await h.caller.slack.runEscalated({
    requestId: id,
    command: "leaveRequest",
  });
  expect(out.result).toEqual({ reply: "Got it, I've passed this to Arek." });
  expect((await h.outbox())[0]?.text).toBe("Got it, I've passed this to Arek.");
  await h.close();
});

test("withdraw withdraws their other open request", async () => {
  const h = await harness();
  const other = await h.caller.requests.file({
    title: "Older",
    source: "slack",
    externalId: "D1:1600000000.000001",
    sourceHandle: "U1",
    fromName: "Dana",
  });
  const { id } = await h.escalate("never mind that");
  await h.caller.slack.runEscalated({ requestId: id, command: "withdraw" });
  const older = await h.caller.requests.get({ id: other.result.request.id });
  expect(older.request.outcome).toBe("handled");
  expect((await h.outbox())[0]?.text).toBe("OK, withdrawn.");
  await h.close();
});

test("addToRequest queues no reply", async () => {
  const h = await harness();
  const other = await h.caller.requests.file({
    title: "Older",
    body: "first",
    source: "slack",
    externalId: "D1:1700000000.000000",
    sourceHandle: "U1",
    fromName: "Dana",
  });
  const { id } = await h.escalate("and one more thing");
  const out = await h.caller.slack.runEscalated({
    requestId: id,
    command: "addToRequest",
  });
  expect(out.result).toEqual({ reply: null });
  const older = await h.caller.requests.get({ id: other.result.request.id });
  expect(older.request.body).toBe("first\n\nand one more thing");
  expect((await h.caller.requests.get({ id })).request.outcome).toBe("handled");
  expect(await h.outbox()).toHaveLength(0);
  await h.close();
});

test("dismissEscalation resolves not_for_me and queues nothing", async () => {
  const h = await harness();
  const { id } = await h.escalate("hmm");
  await h.caller.slack.dismissEscalation({ requestId: id });
  expect((await h.caller.requests.get({ id })).request.outcome).toBe(
    "not_for_me",
  );
  expect(await h.outbox()).toHaveLength(0);
  await h.close();
});
