import { mintRunToken } from "@dlh/server";
import { testServer } from "@dlh/server/testing";
import { and, eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { z } from "zod";
import { requests } from "../../requests/src/db/schema";
import { requestAction } from "../../requests/src/schema";
import requestsServer from "../../requests/src/server";
import tasksServer from "../../tasks/src/server";
import {
  agentConnections,
  agentRunEvents,
  agentRunMessages,
  agentRuns,
} from "../src/db/schema";
import { agentOps } from "../src/operations";
import agentServer from "../src/server";
import { setup } from "./setup";

type S = Awaited<ReturnType<typeof setup>>;

/** The test clock (`testDeps`' frozen now). */
const NOW = new Date("2026-10-30T12:00:00.000Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

/** A caller signed in as the host's worker, on its own connection. */
function worker(s: S) {
  return testServer(s.db, [tasksServer, requestsServer, agentServer], {
    principal: { kind: "worker", tokenId: "w" },
  }).caller;
}

/** A task of the agent's with one run in `status` (running: started and beating now). */
async function withRun(
  s: S,
  status = "running",
  run: Partial<typeof agentRuns.$inferInsert> = {},
  title?: string,
) {
  const task = await s.mkTask(title);
  await s.deps.db.execute(
    sql`update tasks set assignee = 'agent' where item_id = ${task.id}`,
  );
  const [row] = await s.deps.db
    .insert(agentRuns)
    .values({
      taskId: task.id,
      status,
      ...(status === "running" ? { heartbeatAt: NOW, startedAt: NOW } : {}),
      ...run,
    })
    .returning();
  if (!row) throw new Error("no run");
  return { task, run: row };
}

async function runById(s: S, id: string) {
  const [row] = await s.deps.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, id));
  return row;
}

async function requestsFiledAs(s: S, externalId: string) {
  return s.deps.db
    .select()
    .from(requests)
    .where(
      and(eq(requests.source, "agent"), eq(requests.externalId, externalId)),
    );
}

async function requestById(s: S, id: string) {
  const [row] = await s.deps.db
    .select()
    .from(requests)
    .where(eq(requests.itemId, id));
  return row;
}

/** The actions a request was filed with. */
const actionsOf = (req: { actions: unknown }) =>
  z.array(requestAction).parse(req.actions);

async function liveTokens(s: S, runId: string) {
  const rows = await s.deps.db.execute<{ n: number }>(
    sql`select count(*)::int as n from service_tokens where run_id = ${runId} and revoked_at is null`,
  );
  return rows[0]?.n;
}

async function completedAt(s: S, taskId: string) {
  const rows = await s.deps.db.execute<{ completed_at: string | null }>(
    sql`select completed_at from tasks where item_id = ${taskId}`,
  );
  return rows[0]?.completed_at;
}

const beat = {
  turns: 4,
  inputTokens: 1200,
  outputTokens: 300,
  costUsd: 0.42,
};

/** Suspends `runId` at event `seq` for an approval, and returns the filed request. */
async function suspended(
  s: S,
  runId: string,
  seq = 5,
  extra: Partial<
    Parameters<ReturnType<typeof worker>["agent"]["suspend"]>[0]
  > = {},
) {
  await worker(s).agent.suspend({
    runId,
    sessionId: "sess-1",
    seq,
    kind: "approval",
    title: "Approve: merge PR #12",
    body: "gh pr merge 12",
    tool: "Bash",
    inputHash: "abc",
    ...extra,
  });
  const [req] = await requestsFiledAs(s, `${runId}:${seq}`);
  if (!req) throw new Error("no request filed");
  return req;
}

const report = {
  summary: "Fixed the build",
  links: [{ label: "PR", url: "https://example.com/pr/1" }],
  filesChanged: ["src/a.ts"],
};

test("heartbeat stores the counters and lets a run go on", async () => {
  const s = await setup();
  const { run } = await withRun(s, "running", { heartbeatAt: minutesAgo(1) });
  const out = await worker(s).agent.heartbeat({ runId: run.id, ...beat });
  expect(out.result).toEqual({ stop: false });
  expect(await runById(s, run.id)).toMatchObject({
    status: "running",
    heartbeatAt: NOW,
    turns: 4,
    inputTokens: 1200,
    outputTokens: 300,
    costUsd: "0.4200",
  });
  await s.close();
});

test("heartbeat stops a run whose task was completed", async () => {
  const s = await setup();
  const { task, run } = await withRun(s);
  await s.deps.db.transaction((tx) => mintRunToken(tx, run.id));
  await s.caller.tasks.complete({
    id: task.id,
    expectedUpdatedAt: task.updatedAt,
  });
  const out = await worker(s).agent.heartbeat({ runId: run.id, ...beat });
  expect(out.result).toEqual({ stop: true });
  expect(await runById(s, run.id)).toMatchObject({
    status: "cancelled",
    finishedAt: NOW,
  });
  expect(await liveTokens(s, run.id)).toBe(0);
  await s.close();
});

test("heartbeat stops a run whose task was deleted or taken back", async () => {
  const s = await setup();
  const gone = await withRun(s);
  const mine = await withRun(s);
  await s.deps.db.execute(
    sql`update items set deleted_at = now() where id = ${gone.task.id}`,
  );
  await s.deps.db.execute(
    sql`update tasks set assignee = 'me' where item_id = ${mine.task.id}`,
  );
  for (const { run } of [gone, mine]) {
    const out = await worker(s).agent.heartbeat({ runId: run.id, ...beat });
    expect(out.result).toEqual({ stop: true });
    expect((await runById(s, run.id))?.status).toBe("cancelled");
  }
  await s.close();
});

test("heartbeat for a run no longer running says stop and changes nothing", async () => {
  const s = await setup();
  const { run } = await withRun(s, "queued");
  const out = await worker(s).agent.heartbeat({ runId: run.id, ...beat });
  expect(out.result).toEqual({ stop: true });
  expect(await runById(s, run.id)).toMatchObject({
    status: "queued",
    turns: 0,
  });
  await s.close();
});

test('heartbeat past the cost cap fails the run with "Cost cap reached ($10.00)"', async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await s.deps.db.transaction((tx) => mintRunToken(tx, run.id));
  const out = await worker(s).agent.heartbeat({
    runId: run.id,
    ...beat,
    costUsd: 10,
  });
  expect(out.result).toEqual({ stop: true });
  expect(await runById(s, run.id)).toMatchObject({
    status: "failed",
    failureCode: "cost_cap",
    failureMessage: "Cost cap reached ($10.00)",
    failures: 1,
    finishedAt: NOW,
    costUsd: "10.0000",
  });
  const [req] = await requestsFiledAs(s, `${run.id}:fail:1`);
  expect(req?.body).toBe("Cost cap reached ($10.00)");
  expect(await liveTokens(s, run.id)).toBe(0);
  await s.close();
});

test("the cost cap applied is the one in settings", async () => {
  const s = await setup();
  await s.caller.agent.setSettings({ maxCostUsd: 2.5 });
  const { run } = await withRun(s);
  await worker(s).agent.heartbeat({ runId: run.id, ...beat, costUsd: 3 });
  expect((await runById(s, run.id))?.failureMessage).toBe(
    "Cost cap reached ($2.50)",
  );
  await s.close();
});

test('heartbeat past the time cap fails the run with "Time cap reached (240 min)"', async () => {
  const s = await setup();
  // 239 minutes used, and a minute since the last heartbeat.
  const { run } = await withRun(s, "running", {
    runningMs: 239 * 60_000,
    heartbeatAt: minutesAgo(1),
  });
  const out = await worker(s).agent.heartbeat({ runId: run.id, ...beat });
  expect(out.result).toEqual({ stop: true });
  expect(await runById(s, run.id)).toMatchObject({
    status: "failed",
    failureCode: "time_cap",
    failureMessage: "Time cap reached (240 min)",
    runningMs: 240 * 60_000,
  });
  await s.close();
});

test("time spent waiting doesn't count toward the time cap", async () => {
  const s = await setup();
  // First started five hours ago, but only a minute of that was running.
  const { run } = await withRun(s, "running", {
    startedAt: minutesAgo(300),
    heartbeatAt: minutesAgo(1),
  });
  const w = worker(s);
  await w.agent.heartbeat({ runId: run.id, ...beat });
  await suspended(s, run.id, 5);
  await s.caller.agent.decide({ runId: run.id, seq: 5, approve: true });
  await w.agent.claim({});
  const out = await w.agent.heartbeat({ runId: run.id, ...beat });
  expect(out.result).toEqual({ stop: false });
  expect(await runById(s, run.id)).toMatchObject({
    status: "running",
    runningMs: 60_000,
  });
  await s.close();
});

test("a run retried after the time cap gets a fresh allowance", async () => {
  const s = await setup();
  const { task, run } = await withRun(s, "running", {
    runningMs: 240 * 60_000,
  });
  const w = worker(s);
  expect((await w.agent.heartbeat({ runId: run.id, ...beat })).result).toEqual({
    stop: true,
  });
  expect((await runById(s, run.id))?.failureCode).toBe("time_cap");
  await s.caller.agent.retry({ id: task.id });
  expect((await runById(s, run.id))?.runningMs).toBe(0);
  await w.agent.claim({});
  expect((await w.agent.heartbeat({ runId: run.id, ...beat })).result).toEqual({
    stop: false,
  });
  expect((await runById(s, run.id))?.status).toBe("running");
  await s.close();
});

test("a run retried after the cost cap gets a fresh allowance", async () => {
  const s = await setup();
  const { task, run } = await withRun(s);
  const w = worker(s);
  const at = (costUsd: number) =>
    w.agent.heartbeat({ runId: run.id, ...beat, costUsd });
  expect((await at(10)).result).toEqual({ stop: true });
  await s.caller.agent.retry({ id: task.id });
  expect((await runById(s, run.id))?.costBaseUsd).toBe("10.0000");
  await w.agent.claim({});
  // The run's cost goes on counting; the cap counts from the Retry.
  expect((await at(19.99)).result).toEqual({ stop: false });
  expect((await at(20)).result).toEqual({ stop: true });
  expect(await runById(s, run.id)).toMatchObject({
    status: "failed",
    failureMessage: "Cost cap reached ($10.00)",
    failures: 2,
  });
  await s.close();
});

test("retry undo restores the allowance the run had used", async () => {
  const s = await setup();
  const { task, run } = await withRun(s, "running", {
    runningMs: 240 * 60_000,
    costUsd: "3",
  });
  await worker(s).agent.heartbeat({ runId: run.id, ...beat, costUsd: 3 });
  const out = await s.caller.agent.retry({ id: task.id });
  await s.caller.ops.undo({ id: "agent.retry", token: out.undo });
  expect(await runById(s, run.id)).toMatchObject({
    status: "failed",
    runningMs: 240 * 60_000,
    costBaseUsd: "0.0000",
  });
  await s.close();
});

test("appendEvents ignores a repeated seq", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const ev = (seq: number, text: string) => ({
    seq,
    at: NOW.toISOString(),
    kind: "text" as const,
    data: { text },
  });
  await worker(s).agent.appendEvents({
    runId: run.id,
    events: [ev(1, "one"), ev(2, "two")],
  });
  await worker(s).agent.appendEvents({
    runId: run.id,
    events: [ev(2, "two again"), ev(3, "three")],
  });
  const rows = await s.deps.db
    .select()
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, run.id))
    .orderBy(agentRunEvents.seq);
  expect(rows.map((r) => [r.seq, r.data])).toEqual([
    [1, { text: "one" }],
    [2, { text: "two" }],
    [3, { text: "three" }],
  ]);
  await s.close();
});

test("takeMessages hands over undelivered messages oldest first, once", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await s.deps.db.insert(agentRunMessages).values([
    { runId: run.id, body: "second", at: minutesAgo(1) },
    { runId: run.id, body: "first", at: minutesAgo(2) },
    {
      runId: run.id,
      body: "old",
      at: minutesAgo(3),
      deliveredAt: minutesAgo(3),
    },
  ]);
  const first = await worker(s).agent.takeMessages({ runId: run.id });
  expect(first.result.messages.map((m) => m.body)).toEqual(["first", "second"]);
  const again = await worker(s).agent.takeMessages({ runId: run.id });
  expect(again.result.messages).toEqual([]);
  await s.close();
});

test("suspend files the request, stores the session and waits", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const req = await suspended(s, run.id, 5);
  expect(req.actions).toEqual([
    {
      label: "Approve",
      operation: "agent.decide",
      input: { runId: run.id, seq: 5, approve: true },
    },
    {
      label: "Decline",
      operation: "agent.decide",
      input: { runId: run.id, seq: 5, approve: false },
    },
  ]);
  expect(req.body).toBe("gh pr merge 12");
  expect(await runById(s, run.id)).toMatchObject({
    status: "waiting",
    sessionId: "sess-1",
    pending: {
      requestId: req.itemId,
      seq: 5,
      kind: "approval",
      tool: "Bash",
      inputHash: "abc",
    },
  });
  await s.close();
});

test("suspend files one request even when retried", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const first = await suspended(s, run.id, 5);
  // The first answer was lost: the same call again changes nothing.
  const again = await worker(s).agent.suspend({
    runId: run.id,
    sessionId: "sess-1",
    seq: 5,
    kind: "approval",
    title: "Approve: merge PR #12",
    body: "gh pr merge 12",
  });
  expect(again.result).toMatchObject({
    status: "waiting",
    pending: { requestId: first.itemId, seq: 5 },
  });
  expect(await requestsFiledAs(s, `${run.id}:5`)).toHaveLength(1);
  expect((await runById(s, run.id))?.pending?.requestId).toBe(first.itemId);
  await s.close();
});

test("suspend of a request already filed with the run's next id is CONFLICT", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await s.file("Approve: anything", {
    source: "agent",
    externalId: `${run.id}:5`,
  });
  await expect(suspended(s, run.id, 5)).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect((await runById(s, run.id))?.status).toBe("running");
  await s.close();
});

test("fail of a request already filed with the run's next id is CONFLICT", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await s.file("Needs you: anything", {
    source: "agent",
    externalId: `${run.id}:fail:1`,
  });
  await expect(
    worker(s).agent.fail({ runId: run.id, code: "crash", message: "x" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await runById(s, run.id))?.status).toBe("running");
  await s.close();
});

test("suspend for a grant needs its connection", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await expect(
    worker(s).agent.suspend({
      runId: run.id,
      sessionId: "s",
      seq: 1,
      kind: "grant",
      title: "Use AWS?",
      body: "",
    }),
  ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  expect((await runById(s, run.id))?.status).toBe("running");
  await s.close();
});

test("finish twice is a no-op the second time", async () => {
  const s = await setup();
  const { task, run } = await withRun(s);
  const w = worker(s);
  const first = await w.agent.finish({ runId: run.id, report });
  const done = await completedAt(s, task.id);
  const again = await w.agent.finish({ runId: run.id, report });
  expect(again.result).toEqual(first.result);
  expect(await completedAt(s, task.id)).toEqual(done);
  await s.close();
});

test("fail twice files one request", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const w = worker(s);
  const first = await w.agent.fail({
    runId: run.id,
    code: "crash",
    message: "x",
  });
  const again = await w.agent.fail({
    runId: run.id,
    code: "crash",
    message: "x",
  });
  expect(again.result).toEqual(first.result);
  expect(await requestsFiledAs(s, `${run.id}:fail:1`)).toHaveLength(1);
  expect(await requestsFiledAs(s, `${run.id}:fail:2`)).toHaveLength(0);
  expect((await runById(s, run.id))?.failures).toBe(1);
  await s.close();
});

test("a worker operation on a run that isn't running is CONFLICT", async () => {
  const s = await setup();
  const { run } = await withRun(s, "waiting");
  const w = worker(s);
  await expect(
    w.agent.appendEvents({ runId: run.id, events: [] }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(w.agent.takeMessages({ runId: run.id })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  await expect(
    w.agent.fail({ runId: run.id, code: "crash", message: "x" }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    w.agent.suspend({
      runId: run.id,
      sessionId: "s",
      seq: 1,
      kind: "approval",
      title: "t",
      body: "",
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await s.close();
});

test("decide approves, resolves the request and queues the run", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const req = await suspended(s, run.id, 5);
  await s.caller.agent.decide({ runId: run.id, seq: 5, approve: true });
  const queued = await runById(s, run.id);
  expect(queued).toMatchObject({ status: "queued", pending: null });
  // The approved action comes from the API's copy, not the run's volume.
  expect(queued?.decision).toEqual({
    seq: 5,
    approve: true,
    delivered: false,
    tool: "Bash",
    inputHash: "abc",
  });
  expect((await requestById(s, req.itemId))?.outcome).toBe("handled");
  await s.close();
});

test("decide on a stale seq conflicts", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await suspended(s, run.id, 5);
  await expect(
    s.caller.agent.decide({ runId: run.id, seq: 4, approve: true }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await runById(s, run.id))?.status).toBe("waiting");
  await s.close();
});

test("decide twice with the same answer is a no-op", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await suspended(s, run.id, 5);
  await s.caller.agent.decide({ runId: run.id, seq: 5, approve: false });
  await s.caller.agent.decide({ runId: run.id, seq: 5, approve: false });
  expect(await runById(s, run.id)).toMatchObject({
    status: "queued",
    decision: { seq: 5, approve: false, delivered: false },
  });
  // Still a no-op once the claim delivered it and the run is running again.
  await worker(s).agent.claim({});
  await s.caller.agent.decide({ runId: run.id, seq: 5, approve: false });
  expect((await runById(s, run.id))?.status).toBe("running");
  await expect(
    s.caller.agent.decide({ runId: run.id, seq: 5, approve: true }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await s.close();
});

test("decide on a cancelled run conflicts", async () => {
  const s = await setup();
  const { task, run } = await withRun(s);
  await suspended(s, run.id, 5);
  await s.caller.agent.cancel({ id: task.id });
  await expect(
    s.caller.agent.decide({ runId: run.id, seq: 5, approve: true }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await s.close();
});

test("an approved grant adds the connection", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const { id } = (
    await worker(s).agent.registerConnection({
      name: "GitHub",
      type: "github",
      scopeSummary: "repo",
    })
  ).result;
  await suspended(s, run.id, 7, {
    kind: "grant",
    connectionId: id,
    tool: undefined,
    inputHash: undefined,
  });
  await s.caller.agent.decide({ runId: run.id, seq: 7, approve: true });
  const queued = await runById(s, run.id);
  expect(queued?.connectionIds).toEqual([id]);
  expect(queued?.decision).toEqual({
    seq: 7,
    approve: true,
    delivered: false,
    connectionId: id,
  });
  await s.close();
});

test("a declined grant leaves the connections", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const { id } = (
    await worker(s).agent.registerConnection({
      name: "GitHub",
      type: "github",
      scopeSummary: "repo",
    })
  ).result;
  await suspended(s, run.id, 7, { kind: "grant", connectionId: id });
  await s.caller.agent.decide({ runId: run.id, seq: 7, approve: false });
  expect((await runById(s, run.id))?.connectionIds).toEqual([]);
  await s.close();
});

test("decide undo puts the run back to waiting and reopens the request", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const req = await suspended(s, run.id, 5);
  const before = await runById(s, run.id);
  const out = await s.caller.agent.decide({
    runId: run.id,
    seq: 5,
    approve: true,
  });
  await s.caller.ops.undo({ id: "agent.decide", token: out.undo });
  expect(await runById(s, run.id)).toMatchObject({
    status: "waiting",
    pending: before?.pending,
    decision: null,
  });
  expect((await requestById(s, req.itemId))?.outcome).toBeNull();
  await s.close();
});

test("decide undo after the run was claimed conflicts", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await suspended(s, run.id, 5);
  const out = await s.caller.agent.decide({
    runId: run.id,
    seq: 5,
    approve: true,
  });
  await s.deps.db.execute(
    sql`update agent_runs set heartbeat_at = now() where id = ${run.id}`,
  );
  await expect(
    s.caller.ops.undo({ id: "agent.decide", token: out.undo }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await s.close();
});

test("the request's Approve action runs agent.decide through the Queue", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const req = await suspended(s, run.id, 5);
  const approve = actionsOf(req).find((a) => a.label === "Approve");
  expect(approve?.operation).toBe("agent.decide");
  await s.caller.agent.decide(agentOps.decide.input.parse(approve?.input));
  expect(await runById(s, run.id)).toMatchObject({
    status: "queued",
    decision: { seq: 5, approve: true, delivered: false },
  });
  expect((await requestById(s, req.itemId))?.outcome).toBe("handled");
  await s.close();
});

test("finish completes the task and writes the report", async () => {
  const s = await setup();
  const { task, run } = await withRun(s);
  await worker(s).agent.finish({ runId: run.id, report });
  expect(await runById(s, run.id)).toMatchObject({
    status: "done",
    report,
    finishedAt: NOW,
  });
  expect(await completedAt(s, task.id)).not.toBeNull();
  await s.close();
});

test("finish after a cancel is CONFLICT and the task stays open", async () => {
  const s = await setup();
  const { task, run } = await withRun(s);
  await s.caller.agent.cancel({ id: task.id });
  await expect(
    worker(s).agent.finish({ runId: run.id, report }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await completedAt(s, task.id)).toBeNull();
  expect((await runById(s, run.id))?.status).toBe("cancelled");
  await s.close();
});

test('"Needs you" is cut to the title limit with a trailing "…"', async () => {
  const s = await setup();
  const { run } = await withRun(s, "running", {}, "x".repeat(500));
  await worker(s).agent.fail({ runId: run.id, code: "crash", message: "x" });
  const [req] = await requestsFiledAs(s, `${run.id}:fail:1`);
  const titles = await s.deps.db.execute<{ title: string }>(
    sql`select title from items where id = ${req?.itemId ?? null}`,
  );
  const title = titles[0]?.title ?? "";
  expect(title).toHaveLength(500);
  expect(title).toBe(`Needs you: ${"x".repeat(488)}…`);
  await s.close();
});

test('fail files "Needs you" with a Retry action', async () => {
  const s = await setup();
  const { task, run } = await withRun(s);
  await worker(s).agent.fail({
    runId: run.id,
    code: "stuck",
    message: "I can't find the config",
  });
  const [req] = await requestsFiledAs(s, `${run.id}:fail:1`);
  if (!req) throw new Error("no request filed");
  expect(req.body).toBe("I can't find the config");
  expect(req.actions).toEqual([
    { label: "Retry", operation: "agent.retry", input: { id: task.id } },
  ]);
  const titles = await s.deps.db.execute<{ title: string }>(
    sql`select title from items where id = ${req.itemId}`,
  );
  expect(titles[0]?.title).toBe("Needs you: Fix the build");
  expect(await runById(s, run.id)).toMatchObject({
    status: "failed",
    failures: 1,
    failureCode: "stuck",
    failureMessage: "I can't find the config",
    finishedAt: NOW,
    pending: { requestId: req.itemId, seq: 1, kind: "failure" },
  });
  // The Retry action works as filed and resolves the request.
  const retry = actionsOf(req)[0];
  await s.caller.agent.retry(agentOps.retry.input.parse(retry?.input));
  expect((await runById(s, run.id))?.status).toBe("queued");
  expect((await requestById(s, req.itemId))?.outcome).toBe("handled");
  await s.close();
});

test("a second failure files a second request", async () => {
  const s = await setup();
  const { task, run } = await withRun(s);
  const w = worker(s);
  await w.agent.fail({ runId: run.id, code: "crash", message: "one" });
  await s.caller.agent.retry({ id: task.id });
  await w.agent.claim({});
  await w.agent.fail({ runId: run.id, code: "crash", message: "two" });
  expect(await requestsFiledAs(s, `${run.id}:fail:2`)).toHaveLength(1);
  expect((await runById(s, run.id))?.failures).toBe(2);
  await s.close();
});

test("the run token is revoked when the run leaves running", async () => {
  const s = await setup();
  const w = worker(s);
  const leave = [
    (runId: string) => w.agent.finish({ runId, report }),
    (runId: string) => w.agent.fail({ runId, code: "crash", message: "x" }),
    (runId: string) =>
      w.agent.suspend({
        runId,
        sessionId: "s",
        seq: 1,
        kind: "approval",
        title: "Approve: x",
        body: "",
      }),
  ];
  for (const go of leave) {
    const { run } = await withRun(s);
    await s.deps.db.transaction((tx) => mintRunToken(tx, run.id));
    expect(await liveTokens(s, run.id)).toBe(1);
    await go(run.id);
    expect(await liveTokens(s, run.id)).toBe(0);
  }
  await s.close();
});

test("registerConnection inserts, then updates by name", async () => {
  const s = await setup();
  const w = worker(s);
  const first = await w.agent.registerConnection({
    name: "GitHub",
    type: "github",
    scopeSummary: "repo",
  });
  const again = await w.agent.registerConnection({
    name: "GitHub",
    type: "github",
    scopeSummary: "repo, workflow",
  });
  expect(again.result.id).toBe(first.result.id);
  const rows = await s.deps.db.select().from(agentConnections);
  expect(rows).toHaveLength(1);
  expect(rows[0]?.scopeSummary).toBe("repo, workflow");
  await s.close();
});

test("worker operations are for the worker only", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await expect(
    s.caller.agent.heartbeat({ runId: run.id, ...beat }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await s.close();
});

test("heartbeat stores the image digest once", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  const first = `sha256:${"a".repeat(64)}`;
  await worker(s).agent.heartbeat({ runId: run.id, ...beat, image: first });
  expect((await runById(s, run.id))?.image).toBe(first);
  await worker(s).agent.heartbeat({
    runId: run.id,
    ...beat,
    image: `sha256:${"b".repeat(64)}`,
  });
  await worker(s).agent.heartbeat({ runId: run.id, ...beat });
  expect((await runById(s, run.id))?.image).toBe(first);
  await s.close();
});

test("heartbeat stores the session id, and claim returns it after a restart", async () => {
  const s = await setup();
  const { run } = await withRun(s);
  await worker(s).agent.heartbeat({
    runId: run.id,
    ...beat,
    sessionId: "sess-9",
  });
  expect((await runById(s, run.id))?.sessionId).toBe("sess-9");
  // Heartbeats stopped: the sweep requeues it and the next claim resumes.
  await s.deps.db
    .update(agentRuns)
    .set({ heartbeatAt: minutesAgo(10) })
    .where(eq(agentRuns.id, run.id));
  const out = await worker(s).agent.claim({});
  expect(out.result).toMatchObject({
    run: { id: run.id },
    sessionId: "sess-9",
  });
  await s.close();
});
