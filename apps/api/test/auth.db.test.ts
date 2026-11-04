import { mintRunToken, mintWorkerToken } from "@dlh/server";
import { createTestApi, freshModuleDb, serverModules } from "../src/testing";

test("a service token calls the operations its access allows, and no Core router", async () => {
  const t = await freshModuleDb(serverModules);
  const api = createTestApi({ db: t.db });
  const run = await t.db.transaction((tx) =>
    mintRunToken(tx, "0190a000-0000-7000-8000-000000000001"),
  );
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
