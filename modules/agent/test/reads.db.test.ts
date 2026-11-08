import { expect, test } from "vitest";
import { agentAssignments, agentRuns } from "../src/db/schema";
import { setup } from "./setup";

const report = {
  summary: "Fixed it.",
  links: [{ label: "PR", url: "https://example.com/pr/1" }],
  filesChanged: ["a.ts"],
};

type S = Awaited<ReturnType<typeof setup>>;

async function endedRun(
  s: S,
  title: string,
  extra: Partial<typeof agentRuns.$inferInsert>,
) {
  const task = await s.mkTask(title);
  const [run] = await s.deps.db
    .insert(agentRuns)
    .values({ taskId: task.id, ...extra, status: extra.status ?? "done" })
    .returning();
  if (!run) throw new Error("no run");
  return { task, run };
}

test("recentRuns lists ended runs after since, oldest first", async () => {
  const s = await setup();
  const t = (m: number) => new Date(Date.UTC(2026, 0, 1, 12, m));
  const second = await endedRun(s, "Second", {
    finishedAt: t(20),
    report,
  });
  const first = await endedRun(s, "First", {
    status: "failed",
    finishedAt: t(10),
    failureMessage: "It crashed",
  });
  await endedRun(s, "Too old", { finishedAt: t(0), report });
  await endedRun(s, "Cancelled", { status: "cancelled", finishedAt: t(30) });
  await endedRun(s, "Still running", { status: "running" });
  const request = await s.file("From a DM");
  await s.deps.db
    .insert(agentAssignments)
    .values({ taskId: second.task.id, requestId: request.id });

  const { runs } = await s.caller.agent.recentRuns({ since: t(5) });
  expect(runs).toEqual([
    {
      id: first.run.id,
      taskId: first.task.id,
      taskTitle: "First",
      requestId: null,
      status: "failed",
      finishedAt: t(10).toISOString(),
      report: null,
      failureMessage: "It crashed",
    },
    {
      id: second.run.id,
      taskId: second.task.id,
      taskTitle: "Second",
      requestId: request.id,
      status: "done",
      finishedAt: t(20).toISOString(),
      report,
      failureMessage: null,
    },
  ]);
  await s.close();
});

test("runSource gives a run's task and request, or NOT_FOUND", async () => {
  const s = await setup();
  const { task, run } = await endedRun(s, "Task", {
    finishedAt: new Date(),
    report,
  });
  expect(await s.caller.agent.runSource({ runId: run.id })).toEqual({
    taskId: task.id,
    requestId: null,
  });
  const request = await s.file("From a DM");
  await s.deps.db
    .insert(agentAssignments)
    .values({ taskId: task.id, requestId: request.id });
  expect(await s.caller.agent.runSource({ runId: run.id })).toEqual({
    taskId: task.id,
    requestId: request.id,
  });
  await expect(
    s.caller.agent.runSource({ runId: crypto.randomUUID() }),
  ).rejects.toMatchObject({ code: "NOT_FOUND", message: "No run" });
  await s.close();
});
