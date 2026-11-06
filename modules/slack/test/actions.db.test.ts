import { type AiDecisionProvider, AiError, runMutation } from "@dlh/server";
import { eq, sql } from "drizzle-orm";
import { expect, test } from "vitest";
import { agentRuns } from "../../agent/src/db/schema";
import { slackActions } from "../src/db/schema";
import type { HandleActionInput, HandleMessageInput } from "../src/schema";
import { setup } from "./setup";

type Setup = Awaited<ReturnType<typeof setup>>;

/** Jev picks the action; the gateway's model answers from a queue. Plain fakes, not vi.fn. */
async function harness(choice: string) {
  const s = await setup();
  const completions: string[] = [];
  const provider: AiDecisionProvider = {
    id: "vercel",
    async decide() {
      return { choice, confidence: 0.9, probabilities: { [choice]: 0.9 } };
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
  const send = async (text: string) =>
    (await s.slack.slack.handleMessage(message(text))).result;
  const act = async (input: HandleActionInput) =>
    (await s.slack.slack.handleAction(input)).result;
  const taskTitles = async () =>
    (
      await s.db.execute<{ title: string }>(
        sql`select i.title from items i join tasks t on t.item_id = i.id where i.deleted_at is null`,
      )
    ).map((r) => r.title);
  return { ...s, completions, send, act, taskTitles };
}

const buttonInput = (b: { value: string } | undefined): HandleActionInput =>
  JSON.parse(b?.value ?? "");

const versionOf = async (s: Setup, id: string) =>
  (
    await s.db.execute<{ v: string }>(
      sql`select to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as v from items where id = ${id}`,
    )
  )[0]?.v ?? "";

/** A slack_actions row holding the real undo token of an operation the bot ran on a new task. */
async function botAction(
  s: Setup,
  operation: "tasks.create" | "tasks.update",
  extra: { runTaskId?: string } = {},
) {
  const create = s.deps.operations.get("tasks.create");
  const update = s.deps.operations.get("tasks.update");
  if (create?.kind !== "mutation" || update?.kind !== "mutation") {
    throw new Error("tasks operations are missing");
  }
  const made = await runMutation(s.deps, create, { title: "By the bot" });
  const taskId = (made.result as { id: string }).id;
  const ran =
    operation === "tasks.create"
      ? made
      : await runMutation(s.deps, update, {
          id: taskId,
          title: "Renamed by the bot",
          expectedUpdatedAt: await versionOf(s, taskId),
        });
  const [row] = await s.deps.db
    .insert(slackActions)
    .values({ operation, token: ran.undo, ...extra })
    .returning();
  if (!row) throw new Error("no row");
  return { id: row.id, taskId };
}

const isDeleted = async (s: Setup, id: string) =>
  (
    await s.db.execute<{ deleted: boolean }>(
      sql`select deleted_at is not null as deleted from items where id = ${id}`,
    )
  )[0]?.deleted;

test("apply runs the chosen option and offers Undo", async () => {
  const h = await harness("tasks.create|suggest");
  h.completions.push(
    JSON.stringify({
      options: [
        { label: "Chase Dana", title: "Chase Dana" },
        { label: "Call Dana", title: "Call Dana" },
      ],
    }),
  );
  const out = await h.send("maybe add a task about Dana");
  const pick = buttonInput(out.buttons?.[1]);
  const done = await h.act(pick);
  expect(done.reply).toBe("Done: New task Call Dana");
  expect(done.buttons?.map((b) => b.label)).toEqual(["Undo"]);
  expect(buttonInput(done.buttons?.[0])).toMatchObject({ do: "undo" });
  expect(await h.taskTitles()).toEqual(["Call Dana"]);
  await h.close();
});

test("discard drops the suggestion", async () => {
  const h = await harness("tasks.create|suggest");
  h.completions.push(
    JSON.stringify({ options: [{ label: "Chase Dana", title: "Chase Dana" }] }),
  );
  const out = await h.send("maybe add a task about Dana");
  const none = buttonInput(out.buttons?.at(-1));
  expect(await h.act(none)).toEqual({ reply: "OK, dropped." });
  expect((await h.act(none)).reply).toMatch(/already/);
  await h.close();
});

test("undo reverts a Do", async () => {
  const h = await harness("tasks.create|do");
  h.completions.push(JSON.stringify({ title: "Chase Dana" }));
  const out = await h.send("add a task to chase Dana");
  const undo = buttonInput(out.buttons?.[0]);
  expect(await h.act(undo)).toEqual({ reply: "Undid new task." });
  expect(await h.taskTitles()).toEqual([]);
  await h.close();
});

test("a second undo is a no-op reply", async () => {
  const h = await harness("tasks.create|do");
  h.completions.push(JSON.stringify({ title: "Chase Dana" }));
  const out = await h.send("add a task to chase Dana");
  const undo = buttonInput(out.buttons?.[0]);
  await h.act(undo);
  const again = await h.act(undo);
  expect(again.reply).toBe(
    "This AI request has already finished or been used.",
  );
  expect(again.buttons).toBeUndefined();
  await h.close();
});

test("a row the app made is refused", async () => {
  const h = await harness("tasks.create|do");
  h.completions.push(JSON.stringify({ title: "Chase Dana" }));
  const out = await h.send("add a task to chase Dana");
  const undo = buttonInput(out.buttons?.[0]);
  if (undo.do !== "undo") throw new Error("expected an undo button");
  await h.db.execute(
    sql`update ai_requests set origin = 'app' where id = ${undo.aiRequestId}`,
  );
  await expect(h.act(undo)).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    h.act({ do: "discard", aiRequestId: undo.aiRequestId }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  await expect(
    h.act({ do: "apply", aiRequestId: undo.aiRequestId, option: 0 }),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(await h.taskTitles()).toEqual(["Chase Dana"]);
  await h.close();
});

test("undoAction reverts once", async () => {
  const s = await harness("escalate");
  const a = await botAction(s, "tasks.create");
  expect(await s.act({ do: "undoAction", slackActionId: a.id })).toEqual({
    reply: "Undid new task.",
  });
  expect(await isDeleted(s, a.taskId)).toBe(true);
  const [row] = await s.db
    .select()
    .from(slackActions)
    .where(eq(slackActions.id, a.id));
  expect(row?.usedAt).not.toBeNull();
  expect(await s.act({ do: "undoAction", slackActionId: a.id })).toEqual({
    reply: "Already undone.",
  });
  await s.close();
});

test("undoAction replies Changed since on a conflict, with Cancel run when a run started", async () => {
  const s = await harness("escalate");
  const task = await s.caller.tasks.create({ title: "Run me" });
  const a = await botAction(s, "tasks.update", { runTaskId: task.result.id });
  await s.caller.tasks.update({
    id: a.taskId,
    title: "Edited since",
    expectedUpdatedAt: await versionOf(s, a.taskId),
  });
  const out = await s.act({ do: "undoAction", slackActionId: a.id });
  expect(out.reply).toBe("Changed since");
  expect(out.buttons?.map((b) => b.label)).toEqual(["Cancel run"]);
  expect(buttonInput(out.buttons?.[0])).toEqual({
    do: "cancelRun",
    taskId: task.result.id,
  });
  // The conflict left the row unused.
  const [row] = await s.db
    .select()
    .from(slackActions)
    .where(eq(slackActions.id, a.id));
  expect(row?.usedAt).toBeNull();
  await s.close();
});

test("cancelRun cancels the task's run", async () => {
  const s = await harness("escalate");
  const { result: task } = await s.caller.tasks.create({ title: "Fix it" });
  await s.db.execute(
    sql`update tasks set assignee = 'agent' where item_id = ${task.id}`,
  );
  const [run] = await s.db
    .insert(agentRuns)
    .values({ taskId: task.id, status: "running" })
    .returning();
  expect(await s.act({ do: "cancelRun", taskId: task.id })).toEqual({
    reply: "Cancelled.",
  });
  const [after] = await s.db
    .select()
    .from(agentRuns)
    .where(eq(agentRuns.id, run?.id ?? ""));
  expect(after?.status).toBe("cancelled");
  await s.close();
});
