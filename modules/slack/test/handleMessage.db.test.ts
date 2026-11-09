import { type AiDecisionProvider, AiError } from "@dlh/server";
import { sql } from "drizzle-orm";
import { expect, test, vi } from "vitest";
import type { HandleMessageInput } from "../src/schema";
import * as coworker from "../src/server/coworker";
import { setup } from "./setup";

// A passthrough spy: the login a message is handled under is not stored anywhere else yet.
vi.mock("../src/server/coworker", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/server/coworker")>();
  return { ...real, sendersRequests: vi.fn(real.sendersRequests) };
});

type Pick = { choice: string; confidence: number } | "fail";

/** Plain async fakes, not vi.fn: vitest's spy reports a rejecting call as unhandled. */
function fakeJev(picks: Pick[], replies: string[] = []) {
  const decisions: { input: string }[] = [];
  const completions: { prompt: string }[] = [];
  const provider: AiDecisionProvider = {
    id: "vercel",
    async decide(req) {
      decisions.push({ input: req.input });
      const next = picks.shift();
      if (!next || next === "fail") {
        throw new AiError("provider_unavailable", "Jev is down");
      }
      return {
        choice: next.choice,
        confidence: next.confidence,
        probabilities: { [next.choice]: next.confidence },
      };
    },
    async complete(req) {
      completions.push({ prompt: req.prompt });
      return { raw: JSON.stringify({ reply: replies.shift() ?? "A reply" }) };
    },
  };
  return { provider, decisions, completions };
}

async function harness(picks: Pick[] = [], replies: string[] = []) {
  const s = await setup();
  const jev = fakeJev(picks, replies);
  s.slackDeps.ai.providers.vercel = jev.provider;
  await s.caller.slack.setSettings({ ownerSlackId: "UOWNER" });
  let n = 0;
  const message = (
    text: string,
    over: {
      event?: Partial<HandleMessageInput["event"]>;
      sender?: Partial<HandleMessageInput["sender"]>;
      context?: HandleMessageInput["context"];
    } = {},
  ): HandleMessageInput => {
    n += 1;
    return {
      event: {
        channel: "D1",
        ts: `1700000000.00000${n}`,
        text,
        permalink: `https://example.slack.com/archives/D1/p${n}`,
        isDm: true,
        ...over.event,
      },
      sender: {
        slackUserId: "U1",
        name: "Dana",
        githubLogin: null,
        isOwner: false,
        ...over.sender,
      },
      context: over.context ?? [],
    };
  };
  const requests = async () => (await s.caller.requests.open({})).items;
  const aiRows = async () =>
    (
      await s.db.execute<{ n: number }>(
        sql`select count(*)::int as n from ai_requests`,
      )
    )[0]?.n ?? 0;
  return { ...s, jev, message, requests, aiRows };
}

test("not set up replies Not set up yet. and files nothing", async () => {
  const h = await harness();
  await h.caller.slack.setSettings({ ownerSlackId: null });
  const out = await h.slack.slack.handleMessage(h.message("hi"));
  expect(out.result).toEqual({ reply: "Not set up yet." });
  expect(await h.requests()).toHaveLength(0);
  await h.close();
});

test("the owner's message goes to the owner path, not the coworker one", async () => {
  const h = await harness([{ choice: "escalate", confidence: 0.9 }]);
  const out = await h.slack.slack.handleMessage(
    h.message("hi", { sender: { slackUserId: "UOWNER", isOwner: true } }),
  );
  expect(out.result.reply).toBe(
    "Not sure what you meant, so I put it in your queue.",
  );
  await h.close();
});

test("leaveRequest files with the slack fields and replies with the ack text", async () => {
  const h = await harness([{ choice: "leaveRequest", confidence: 0.9 }]);
  const long = `${"x".repeat(100)}\nsecond line`;
  const input = h.message(long);
  const { result } = await h.slack.slack.handleMessage(input);
  expect(result.reply).toBe("Got it, I've passed this to Arek.");
  expect(result.filedRequestId).toBeDefined();
  const { request } = await h.caller.requests.get({
    id: result.filedRequestId as string,
  });
  expect(request).toMatchObject({
    source: "slack",
    externalId: `D1:${input.event.ts}`,
    sourceUrl: input.event.permalink,
    sourceHandle: "U1",
    fromName: "Dana",
    title: "x".repeat(80),
    body: long,
  });
  await h.close();
});

test("the same event twice files once", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    { choice: "leaveRequest", confidence: 0.9 },
  ]);
  const input = h.message("please look at this");
  const a = await h.slack.slack.handleMessage(input);
  const b = await h.slack.slack.handleMessage(input);
  expect(b.result.reply).toBe(a.result.reply);
  expect(b.result.filedRequestId).toBe(a.result.filedRequestId);
  expect(await h.requests()).toHaveLength(1);
  await h.close();
});

test("two messages in a row append once each", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    { choice: "addToRequest", confidence: 0.9 },
    { choice: "addToRequest", confidence: 0.9 },
  ]);
  const first = await h.slack.slack.handleMessage(h.message("first"));
  const second = h.message("second");
  const third = h.message("third");
  expect((await h.slack.slack.handleMessage(second)).result).toEqual({
    react: "eyes",
  });
  expect((await h.slack.slack.handleMessage(third)).result).toEqual({
    react: "eyes",
  });
  // A redelivery of the second adds nothing.
  await h.slack.slack.handleMessage(second);
  const rows = await h.requests();
  expect(rows).toHaveLength(1);
  const { request } = await h.caller.requests.get({
    id: first.result.filedRequestId as string,
  });
  expect(request.body).toContain("first");
  expect(request.body).toContain("second");
  expect(request.body).toContain("third");
  expect(request.body?.match(/second/g)).toHaveLength(1);
  await h.close();
});

test("a message after resolve files a new request", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    { choice: "leaveRequest", confidence: 0.9 },
  ]);
  const a = await h.slack.slack.handleMessage(h.message("one"));
  const { request } = await h.caller.requests.get({
    id: a.result.filedRequestId as string,
  });
  await h.caller.requests.resolve({
    id: request.id,
    expectedUpdatedAt: request.updatedAt,
    outcome: "handled",
  });
  const b = await h.slack.slack.handleMessage(h.message("two"));
  expect(b.result.filedRequestId).toBeDefined();
  expect(b.result.filedRequestId).not.toBe(request.id);
  await h.close();
});

test("a message in another DM files a new request", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    { choice: "leaveRequest", confidence: 0.9 },
  ]);
  await h.slack.slack.handleMessage(h.message("one"));
  // addToRequest is not offered, so Jev is only asked about the rest.
  await h.slack.slack.handleMessage(
    h.message("two", { event: { channel: "D2" } }),
  );
  expect(await h.requests()).toHaveLength(2);
  expect(h.jev.decisions).toHaveLength(2);
  await h.close();
});

test("a Jev failure files by rule", async () => {
  const h = await harness(["fail", "fail"]);
  const a = await h.slack.slack.handleMessage(h.message("one"));
  expect(a.result.reply).toBe("Got it, I've passed this to Arek.");
  expect(a.result.filedRequestId).toBeDefined();
  // Inside the window the rule is to append.
  const b = await h.slack.slack.handleMessage(h.message("two"));
  expect(b.result).toEqual({ react: "eyes" });
  expect(await h.requests()).toHaveLength(1);
  expect(await h.aiRows()).toBe(2);
  const failed = await h.db.execute<{ status: string }>(
    sql`select status from ai_requests`,
  );
  expect(failed.every((r) => r.status === "failed")).toBe(true);
  await h.close();
});

test("coworkerAi off makes no AI calls", async () => {
  const h = await harness();
  await h.caller.slack.setSettings({ coworkerAi: false });
  const a = await h.slack.slack.handleMessage(h.message("one"));
  expect(a.result.filedRequestId).toBeDefined();
  expect((await h.slack.slack.handleMessage(h.message("two"))).result).toEqual({
    react: "eyes",
  });
  expect(await h.aiRows()).toBe(0);
  expect(h.jev.decisions).toHaveLength(0);
  await h.close();
});

test("low confidence escalates with Bot wasn't sure and the ack", async () => {
  const h = await harness([{ choice: "leaveRequest", confidence: 0.3 }]);
  const { result } = await h.slack.slack.handleMessage(
    h.message("hmm what about the thing"),
  );
  expect(result.reply).toBe("Got it, I've passed this to Arek.");
  const { request } = await h.caller.requests.get({
    id: result.filedRequestId as string,
  });
  expect(request.title).toBe("Bot wasn't sure: hmm what about the thing");
  expect(request.body).toBe("hmm what about the thing");
  expect(request.actions?.map((a) => a.label)).toEqual([
    "Keep as a request",
    "Reply with their status",
    "Neither",
  ]);
  await h.close();
});

test("an escalate pick escalates too", async () => {
  const h = await harness([{ choice: "escalate", confidence: 0.95 }]);
  const { result } = await h.slack.slack.handleMessage(
    h.message("what is Arek's calendar"),
  );
  const { request } = await h.caller.requests.get({
    id: result.filedRequestId as string,
  });
  expect(request.title).toBe("Bot wasn't sure: what is Arek's calendar");
  await h.close();
});

test("withdraw resolves their newest open request as handled", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    { choice: "withdraw", confidence: 0.9 },
  ]);
  const a = await h.slack.slack.handleMessage(h.message("one"));
  const { result } = await h.slack.slack.handleMessage(h.message("forget it"));
  expect(result).toEqual({ reply: "OK, withdrawn." });
  const { request } = await h.caller.requests.get({
    id: a.result.filedRequestId as string,
  });
  expect(request.outcome).toBe("handled");
  await h.close();
});

test("requestStatus replies with the model's words", async () => {
  const h = await harness(
    [
      { choice: "leaveRequest", confidence: 0.9 },
      { choice: "requestStatus", confidence: 0.9 },
    ],
    ["Your request is still open."],
  );
  await h.slack.slack.handleMessage(h.message("one"));
  const { result } = await h.slack.slack.handleMessage(
    h.message("did you see it?"),
  );
  expect(result).toEqual({ reply: "Your request is still open." });
  const row = await h.db.execute<{ action_id: string; origin: string }>(
    sql`select action_id, origin from ai_requests where action_id = 'slack.coworkerReply'`,
  );
  expect(row).toHaveLength(1);
  expect(row[0]?.origin).toBe("slack");
  await h.close();
});

test("the coworker reply gives the model 15 seconds, inside the hub call's 30", async () => {
  const h = await harness(
    [{ choice: "requestStatus", confidence: 0.9 }],
    ["Still open."],
  );
  const timeout = vi.spyOn(AbortSignal, "timeout");
  await h.slack.slack.handleMessage(h.message("did you see it?"));
  expect(timeout).toHaveBeenCalledWith(15_000);
  timeout.mockRestore();
  await h.close();
});

test("askAbout context holds only the asker's requests", async () => {
  const h = await harness(
    [
      { choice: "askAbout", confidence: 0.9 },
      { choice: "askAbout", confidence: 0.9 },
    ],
    ["Here you go.", "Nothing yet."],
  );
  await h.caller.requests.file({
    title: "Zebra quarterly budget",
    source: "slack",
    sourceHandle: "U2",
    fromName: "Sam",
  });
  await h.caller.requests.file({
    title: "Dana's own ask",
    source: "slack",
    sourceHandle: "U1",
    fromName: "Dana",
  });
  const { result } = await h.slack.slack.handleMessage(
    h.message("what did I ask for?", {
      context: [{ from: "sender", text: "earlier words" }],
    }),
  );
  expect(result.reply).toBe("Here you go.");
  const prompt = h.jev.completions[0]?.prompt ?? "";
  expect(prompt).toContain("Dana's own ask");
  expect(prompt).toContain("earlier words");
  expect(prompt).not.toContain("Zebra");
  await h.close();
});

test("a reply the model can't give escalates instead", async () => {
  const h = await harness([{ choice: "askAbout", confidence: 0.9 }]);
  h.jev.provider.complete = async () => {
    throw new AiError("timeout", "too slow");
  };
  const { result } = await h.slack.slack.handleMessage(h.message("status?"));
  expect(result.reply).toBe("Got it, I've passed this to Arek.");
  const { request } = await h.caller.requests.get({
    id: result.filedRequestId as string,
  });
  expect(request.title).toBe("Bot wasn't sure: status?");
  await h.close();
});

test("a coworker's reply prompt never contains Bot wasn't sure", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.2 },
    { choice: "requestStatus", confidence: 0.9 },
  ]);
  await h.slack.slack.handleMessage(h.message("odd thing"));
  await h.slack.slack.handleMessage(h.message("did you get it?"));
  const prompt = h.jev.completions[0]?.prompt ?? "";
  expect(prompt).toContain("odd thing");
  expect(prompt).not.toContain("Bot wasn't sure");
  await h.close();
});

test("a redelivered appended message reacts again and files nothing", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    { choice: "addToRequest", confidence: 0.9 },
    { choice: "leaveRequest", confidence: 0.9 },
  ]);
  await h.slack.slack.handleMessage(h.message("first"));
  const second = h.message("second");
  await h.slack.slack.handleMessage(second);
  const before = h.jev.decisions.length;
  const again = await h.slack.slack.handleMessage(second);
  expect(again.result).toEqual({ react: "eyes" });
  expect(h.jev.decisions).toHaveLength(before);
  expect(await h.requests()).toHaveLength(1);
  await h.close();
});

test("a top-level mention doesn't append to a request filed inside a thread", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    { choice: "leaveRequest", confidence: 0.9 },
  ]);
  const inThread = h.message("in thread", {
    event: {
      channel: "C1",
      isDm: false,
      threadTs: "1699999999.000001",
    },
  });
  inThread.event.permalink = `https://example.slack.com/archives/C1/p1?thread_ts=${inThread.event.threadTs}&cid=C1`;
  await h.slack.slack.handleMessage(inThread);
  const top = await h.slack.slack.handleMessage(
    h.message("top level", { event: { channel: "C1", isDm: false } }),
  );
  expect(top.result.filedRequestId).toBeDefined();
  expect(await h.requests()).toHaveLength(2);
  await h.close();
});

test("two top-level channel mentions file two requests", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    // What Jev would pick if a follow-on were offered.
    { choice: "addToRequest", confidence: 0.9 },
  ]);
  await h.slack.slack.handleMessage(
    h.message("first topic", { event: { channel: "C1", isDm: false } }),
  );
  const second = await h.slack.slack.handleMessage(
    h.message("an unrelated topic", { event: { channel: "C1", isDm: false } }),
  );
  expect(second.result.filedRequestId).toBeDefined();
  expect(await h.requests()).toHaveLength(2);
  await h.close();
});

test("a reply in a thread appends to a request filed from another reply in that thread", async () => {
  const h = await harness([
    { choice: "leaveRequest", confidence: 0.9 },
    { choice: "addToRequest", confidence: 0.9 },
  ]);
  const threadTs = "1699999999.000001";
  const first = h.message("reply one", {
    event: { channel: "C1", isDm: false, threadTs },
  });
  first.event.permalink = `https://example.slack.com/archives/C1/p1?thread_ts=${threadTs}&cid=C1`;
  await h.slack.slack.handleMessage(first);
  const second = await h.slack.slack.handleMessage(
    h.message("reply two", { event: { channel: "C1", isDm: false, threadTs } }),
  );
  expect(second.result).toEqual({ react: "eyes" });
  expect(await h.requests()).toHaveLength(1);
  await h.close();
});

test("a manual GitHub login wins over the one Slack sent", async () => {
  const h = await harness([{ choice: "leaveRequest", confidence: 0.9 }]);
  await h.slack.slack.upsertPerson({
    slackUserId: "U1",
    name: "Dana",
    githubLogin: "dana-profile",
  });
  await h.caller.slack.setGithubLogin({
    slackUserId: "U1",
    githubLogin: "dana",
  });
  const spy = vi.mocked(coworker.sendersRequests);
  spy.mockClear();
  await h.slack.slack.handleMessage(
    h.message("hi", { sender: { githubLogin: "someone-else" } }),
  );
  expect(spy.mock.calls[0]?.[1]).toMatchObject({
    slackUserId: "U1",
    githubLogin: "dana",
  });
  await h.close();
});
