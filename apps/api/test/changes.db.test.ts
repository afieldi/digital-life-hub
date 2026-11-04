import { Hono } from "hono";
import { changesHandler } from "../src/changes";
import { createTestApi, freshModuleDb, serverModules } from "../src/testing";

test("an event names the changed items' types", async () => {
  const t = await freshModuleDb(serverModules);
  const api = createTestApi({ db: t.db });
  const token = await api.signIn();
  const app = new Hono().get(
    "/changes",
    changesHandler(api.deps, { batchMs: 30 }),
  );
  const res = await app.request("/changes", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  for (let i = 0; i < 200 && api.deps.changes.size() === 0; i++) {
    await new Promise((r) => setTimeout(r, 5));
  }
  const { result: task } = await api
    .client(token)
    .tasks.create.mutate({ title: "Typed" });
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes("\n\n")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  expect(JSON.parse(text.replace(/^data: /, ""))).toEqual({
    ids: [task.id],
    types: ["task"],
  });
  await reader.cancel();
  await t.close();
});
