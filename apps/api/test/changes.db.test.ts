import {
  findServiceToken,
  mintRunToken,
  mintSlackToken,
  mintWorkerToken,
  revokeSlackToken,
  revokeWorkerToken,
} from "@dlh/server";
import { Hono } from "hono";
import { changesHandler } from "../src/changes";
import { createTestApi, freshModuleDb, serverModules } from "../src/testing";

const changes = (
  api: ReturnType<typeof createTestApi>,
  token: string,
  opts: { heartbeatMs?: number } = {},
) =>
  new Hono()
    .get("/changes", changesHandler(api.deps, opts))
    .request("/changes", { headers: { Authorization: `Bearer ${token}` } });

/** Reads until the stream ends. */
async function drain(reader: ReadableStreamDefaultReader<Uint8Array>) {
  let done = false;
  while (!done) ({ done } = await reader.read());
}

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

test("/changes accepts a worker token", async () => {
  const t = await freshModuleDb(serverModules);
  const api = createTestApi({ db: t.db });
  const token = await mintWorkerToken(t.db);
  const res = await changes(api, token, { heartbeatMs: 20 });
  expect(res.status).toBe(200);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(": ping")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  expect(text).toContain(": ping");
  // Revoking the worker token closes the stream at the next heartbeat.
  const principal = await findServiceToken(t.db, token);
  if (principal?.kind !== "worker") throw new Error("expected a worker");
  expect(await revokeWorkerToken(t.db, principal.tokenId)).toBe(true);
  await drain(reader);
  await t.close();
});

test("/changes accepts a live slack token and closes on revoke", async () => {
  const t = await freshModuleDb(serverModules);
  const api = createTestApi({ db: t.db });
  const token = await mintSlackToken(t.db);
  const res = await changes(api, token, { heartbeatMs: 20 });
  expect(res.status).toBe(200);
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (!text.includes(": ping")) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  expect(text).toContain(": ping");
  const principal = await findServiceToken(t.db, token);
  if (principal?.kind !== "slack") throw new Error("expected slack");
  expect(await revokeSlackToken(t.db, principal.tokenId)).toBe(true);
  await drain(reader);
  await t.close();
});

test("/changes refuses a run token", async () => {
  const t = await freshModuleDb(serverModules);
  const api = createTestApi({ db: t.db });
  const token = await t.db.transaction((tx) =>
    mintRunToken(tx, "0190a000-0000-7000-8000-000000000001"),
  );
  expect((await changes(api, token)).status).toBe(401);
  await t.close();
});
