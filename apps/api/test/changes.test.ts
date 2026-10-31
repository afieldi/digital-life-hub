import { Hono } from "hono";
import { changesHandler } from "../src/changes";
import { createTestApi } from "../src/testing";

function open(
  api: ReturnType<typeof createTestApi>,
  token: string | null,
  opts: { batchMs?: number; heartbeatMs?: number } = {},
) {
  const app = new Hono().get("/changes", changesHandler(api.deps, opts));
  return Promise.resolve(
    app.request("/changes", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
}

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pattern: RegExp,
): Promise<string> {
  const decoder = new TextDecoder();
  let text = "";
  while (!pattern.test(text)) {
    const { value, done } = await reader.read();
    if (done) break;
    text += decoder.decode(value);
  }
  return text;
}

const waitFor = async (cond: () => boolean) => {
  for (let i = 0; i < 200 && !cond(); i++)
    await new Promise((r) => setTimeout(r, 5));
};

const real = (api: ReturnType<typeof createTestApi>, token?: string) =>
  api.fetch("http://api.test/changes", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

test("no token → 401", async () => {
  const api = createTestApi();
  expect((await real(api)).status).toBe(401);
  expect((await real(api, "garbage")).status).toBe(401);
});

test("revoked token → 401", async () => {
  const api = createTestApi();
  const token = await api.signIn();
  const [row] = await api.store.listActiveSessions(api.clock.now());
  await api.store.revokeSession(row?.id ?? "", api.clock.now());
  expect((await real(api, token)).status).toBe(401);
});

test("publishes within a batch arrive as one event", async () => {
  const api = createTestApi();
  const token = await api.signIn();
  const res = await open(api, token, { batchMs: 30 });
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await waitFor(() => api.deps.changes.size() === 1);
  api.deps.changes.publish(["a"]);
  api.deps.changes.publish(["b", "a"]);
  const text = await readUntil(reader, /\n\n/);
  expect(text).toBe('data: {"ids":["a","b"]}\n\n');
  await reader.cancel();
});

test("sends a heartbeat comment", async () => {
  const api = createTestApi();
  const token = await api.signIn();
  const res = await open(api, token, { heartbeatMs: 20 });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  expect(await readUntil(reader, /: ping/)).toContain(": ping");
  await reader.cancel();
});

test("revoking the session closes the stream at the next heartbeat", async () => {
  const api = createTestApi();
  const token = await api.signIn();
  const res = await open(api, token, { heartbeatMs: 20 });
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await readUntil(reader, /: ping/);
  const [row] = await api.store.listActiveSessions(api.clock.now());
  await api.store.revokeSession(row?.id ?? "", api.clock.now());
  let done = false;
  while (!done) ({ done } = await reader.read());
  expect(done).toBe(true);
  await waitFor(() => api.deps.changes.size() === 0);
  expect(api.deps.changes.size()).toBe(0);
});

test("cancelling the reader unsubscribes", async () => {
  const api = createTestApi();
  const token = await api.signIn();
  const res = await real(api, token);
  expect(res.headers.get("content-type")).toContain("text/event-stream");
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  await waitFor(() => api.deps.changes.size() === 1);
  expect(api.deps.changes.size()).toBe(1);
  await reader.cancel();
  await waitFor(() => api.deps.changes.size() === 0);
  expect(api.deps.changes.size()).toBe(0);
});
