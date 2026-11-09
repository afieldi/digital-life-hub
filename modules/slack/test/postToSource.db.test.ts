import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { agentRuns } from "../../agent/src/db/schema";
import { setup } from "./setup";

type S = Awaited<ReturnType<typeof setup>>;

const inThread = {
  externalId: "C9:1700000009.000001",
  sourceUrl:
    "https://example.slack.com/archives/C9/p1700000009000001?thread_ts=1700000005.000001&cid=C9",
};

/** Bob's request, filed with `extra` and given to the agent; returns the run. */
async function runFrom(s: S, extra: Record<string, unknown> = inThread) {
  const filed = await s.caller.requests.file({
    title: "Can you check my PR?",
    source: "slack",
    sourceHandle: "U_BOB",
    fromName: "Bob",
    ...extra,
  } as never);
  const r = filed.result.request;
  const { run, task } = (
    await s.caller.agent.assignRequest({
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
    })
  ).result;
  return { run, task, request: r };
}

const outbox = (s: S) =>
  s.db.execute<{
    key: string;
    origin: string;
    status: string;
    channel_id: string;
    thread_ts: string | null;
    text: string;
    run_id: string | null;
    request_id: string | null;
  }>(
    sql`select key, origin, status, channel_id, thread_ts, text, run_id, request_id from slack_outbox order by created_at, key`,
  );

test("postToSource queues an approved bot post to the request's thread", async () => {
  const s = await setup();
  const { run, request } = await runFrom(s);
  const post = (text: string) =>
    s.asRun(run.id).slack.postToSource({ runId: run.id, text });
  await post("Looking at it now.");
  await post("Done: approved.");
  const rows = await outbox(s);
  expect(rows).toEqual([
    {
      key: `agent:${run.id}:1`,
      origin: "agent",
      status: "approved",
      channel_id: "C9",
      thread_ts: "1700000005.000001",
      text: "Looking at it now.",
      run_id: run.id,
      request_id: request.id,
    },
    expect.objectContaining({
      key: `agent:${run.id}:2`,
      text: "Done: approved.",
    }),
  ]);
  await s.close();
});

test("a message with no thread is answered under itself", async () => {
  const s = await setup();
  const { run } = await runFrom(s, {
    externalId: "D1:1700000000.000001",
    sourceUrl: "https://example.slack.com/archives/D1/p1700000000000001",
  });
  await s.asRun(run.id).slack.postToSource({ runId: run.id, text: "Hi" });
  expect((await outbox(s))[0]).toMatchObject({
    channel_id: "D1",
    thread_ts: "1700000000.000001",
  });
  await s.close();
});

test("a sixth post is refused", async () => {
  const s = await setup();
  const { run } = await runFrom(s);
  const post = (n: number) =>
    s.asRun(run.id).slack.postToSource({ runId: run.id, text: `Post ${n}` });
  for (let n = 1; n <= 5; n++) await post(n);
  await expect(post(6)).rejects.toMatchObject({
    code: "CONFLICT",
    message: "Five posts per run",
  });
  expect((await outbox(s)).map((r) => r.key)).toEqual(
    [1, 2, 3, 4, 5].map((n) => `agent:${run.id}:${n}`),
  );
  await s.close();
});

test("posts at once each get their own number", async () => {
  const s = await setup();
  const { run } = await runFrom(s);
  const caller = s.asRun(run.id);
  await Promise.all(
    [1, 2, 3].map((n) =>
      caller.slack.postToSource({ runId: run.id, text: `Post ${n}` }),
    ),
  );
  expect((await outbox(s)).map((r) => r.key).sort()).toEqual(
    [1, 2, 3].map((n) => `agent:${run.id}:${n}`),
  );
  await s.close();
});

test("a request not from Slack is refused", async () => {
  const s = await setup();
  const refused = {
    code: "BAD_REQUEST",
    message: "This run didn't come from Slack",
  };

  // A task given to the agent from no request.
  const task = await s.caller.tasks.create({ title: "Mine" });
  const [plain] = await s.deps.db
    .insert(agentRuns)
    .values({ taskId: task.result.id, status: "running" })
    .returning();
  if (!plain) throw new Error("no run");
  await expect(
    s.asRun(plain.id).slack.postToSource({ runId: plain.id, text: "Hi" }),
  ).rejects.toMatchObject(refused);

  // A request filed by hand.
  const filed = await s.caller.requests.file({ title: "By hand" });
  const r = filed.result.request;
  const { run } = (
    await s.caller.agent.assignRequest({
      id: r.id,
      expectedUpdatedAt: r.updatedAt,
    })
  ).result;
  await expect(
    s.asRun(run.id).slack.postToSource({ runId: run.id, text: "Hi" }),
  ).rejects.toMatchObject(refused);

  expect(await outbox(s)).toEqual([]);
  await s.close();
});

test("a run posts only for itself, and only 1 to 2000 characters", async () => {
  const s = await setup();
  const { run } = await runFrom(s);
  const other = await runFrom(s, {
    externalId: "C9:1700000010.000001",
    sourceUrl: inThread.sourceUrl,
  });
  await expect(
    s.asRun(run.id).slack.postToSource({ runId: other.run.id, text: "Hi" }),
  ).rejects.toMatchObject({ code: "FORBIDDEN", message: "Not this run" });
  for (const text of ["", "x".repeat(2001)]) {
    await expect(
      s.asRun(run.id).slack.postToSource({ runId: run.id, text }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  }
  await s.asRun(run.id).slack.postToSource({
    runId: run.id,
    text: "x".repeat(2000),
  });
  expect(await outbox(s)).toHaveLength(1);
  await s.close();
});

test("a post whose key is taken is refused, never reported as sent", async () => {
  const s = await setup();
  const { run } = await runFrom(s);
  // A row that holds the first post's key but isn't counted as one of its posts.
  await s.db.execute(
    sql`insert into slack_outbox (key, origin, channel_id, text) values (${`agent:${run.id}:1`}, 'report', 'C9', 'x')`,
  );
  await expect(
    s.asRun(run.id).slack.postToSource({ runId: run.id, text: "Hi" }),
  ).rejects.toMatchObject({ code: "CONFLICT", message: "Five posts per run" });
  await s.close();
});

test("an agent post can't ping a channel or a group", async () => {
  const s = await setup();
  const { run } = await runFrom(s);
  await s.asRun(run.id).slack.postToSource({
    runId: run.id,
    text: "<!channel> <!here> <!here|here> <!everyone> <!subteam^S0123|@eng> <!subteam^S0456> see <@U_BOB> and <https://x.dev|this>",
  });
  expect((await outbox(s))[0]?.text).toBe(
    "@channel @here @here @everyone @eng @group see <@U_BOB> and <https://x.dev|this>",
  );
  await s.close();
});
