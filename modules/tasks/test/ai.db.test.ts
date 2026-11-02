import { coreAiActions } from "@dlh/core";
import {
  CORE_ROUTER_IDS,
  collectServerModules,
  coreAiRunners,
  prepare,
  runMutation,
  undo,
} from "@dlh/server";
import { freshModuleDb, testDeps } from "@dlh/server/testing";
import { sql } from "drizzle-orm";
import { expect, test } from "vitest";
import tasksServer from "../src/server";

async function setup() {
  const t = await freshModuleDb([tasksServer]);
  const collected = collectServerModules([tasksServer], [...CORE_ROUTER_IDS], {
    actions: Object.values(coreAiActions),
    runners: coreAiRunners,
  });
  const deps = testDeps(t.db, {
    itemTypes: ["task", "note"],
    deleteWith: Object.fromEntries(collected.deleteWith),
    operations: collected.operations,
    ai: { runners: collected.aiRunners },
  });
  const create = collected.operations.get("tasks.create");
  if (create?.kind !== "mutation") throw new Error("no tasks.create");
  return { ...t, deps, create };
}

test("addParent via AI links the parent it names to the task on screen, with Undo", async () => {
  const s = await setup();
  const mk = async (title: string) =>
    (await runMutation(s.deps, s.create, { title })).result as { id: string };
  const a = await mk("Buy milk");
  const g = await mk("Groceries");
  const containsLink = () =>
    s.db.execute(
      sql`select id from links where from_id = ${g.id} and to_id = ${a.id} and kind = 'contains'`,
    );

  s.deps.fakeProvider.queue(JSON.stringify({ parentId: "Groceries" }));
  const res = await prepare(s.deps, {
    text: "make this a subtask of groceries",
    itemId: a.id,
    actionId: "tasks.addParent",
    kind: "do",
  });
  expect(res).toMatchObject({ status: "applied" });
  expect(await containsLink()).toHaveLength(1);

  s.deps.setNow(new Date(s.deps.now().getTime() + 1000));
  await undo(s.deps, { requestId: res.requestId });
  expect(await containsLink()).toHaveLength(0);
  await s.close();
});
