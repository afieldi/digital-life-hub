import { mintRunToken, mintWorkerToken } from "@dlh/server";
import { createTestApi, freshModuleDb, serverModules } from "../src/testing";

test("a service token calls the operations its access allows, and no Core router", async () => {
  const t = await freshModuleDb(serverModules);
  const api = createTestApi({ db: t.db });
  // A run token needs a real run: the agent's run guard refuses a run it can't find.
  const you = api.client(await api.signIn());
  const task = (await you.tasks.create.mutate({ title: "For the agent" }))
    .result;
  const queued = (
    await you.agent.assign.mutate({
      id: task.id,
      expectedUpdatedAt: task.updatedAt,
    })
  ).result;
  const run = await t.db.transaction((tx) => mintRunToken(tx, queued.run.id));
  const { result } = await api
    .client(run)
    .tasks.create.mutate({ title: "From a run" });
  expect(result.title).toBe("From a run");
  await expect(api.client(run).auth.me.query()).rejects.toMatchObject({
    data: { code: "UNAUTHORIZED" },
  });
  const worker = await mintWorkerToken(t.db);
  await expect(
    api.client(worker).tasks.create.mutate({ title: "From the worker" }),
  ).rejects.toMatchObject({ data: { code: "FORBIDDEN" } });
  await t.close();
});
