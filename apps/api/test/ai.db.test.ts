import { aiRequests } from "@dlh/db";
import { writeItems } from "@dlh/server";
import { freshTestDb } from "@dlh/server/testing";
import { TRPCClientError } from "@trpc/client";
import { createTestApi } from "../src/testing";

const SUGGEST = JSON.stringify({
  options: [
    { title: "First", reason: "short" },
    { title: "Second", reason: "clear" },
    { title: "Third", reason: "specific" },
  ],
});

const LOG_FIELDS = [
  "id",
  "createdAt",
  "actionId",
  "kind",
  "interpretedBy",
  "provider",
  "model",
  "status",
  "errorCode",
  "durationMs",
  "inputTokens",
  "outputTokens",
  "costUsd",
  "canUndo",
].sort();

async function setup(opts: { noOpenRouter?: boolean } = {}) {
  const t = await freshTestDb();
  const api = createTestApi({
    db: t.db,
    devAuth: true,
    itemTypes: ["test"],
    ...opts,
  });
  const token = await api.signIn();
  const c = api.client(token);
  const mk = (title: string) =>
    writeItems(api.deps, (w) => w.createItem({ type: "test", title }));
  return { api, c, mk, db: t.db, close: t.close };
}

async function failure(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof TRPCClientError) return e;
    throw e;
  }
  throw new Error("expected the call to fail");
}

test("every AI call without a token is UNAUTHORIZED", async () => {
  const { api, close } = await setup();
  const c = api.client();
  const requestId = "0197a000-0000-7000-8000-000000000000";
  const calls = [
    c.ai.prepare.mutate({ text: "x", actionId: "answer", kind: "ask" }),
    c.ai.complete.mutate({ requestId, raw: "{}" }),
    c.ai.cancel.mutate({ requestId }),
    c.ai.applyOption.mutate({ requestId, option: 0 }),
    c.ai.discard.mutate({ requestId }),
    c.ai.undo.mutate({ requestId }),
    c.ai.settings.get.query(),
    c.ai.settings.set.mutate({}),
    c.ai.log.list.query({}),
  ];
  for (const call of calls) {
    expect((await failure(call)).data?.code).toBe("UNAUTHORIZED");
  }
  await close();
});

test("answer with no item", async () => {
  const { api, c, close } = await setup();
  api.ai.queue(JSON.stringify({ answer: "Forty-two.", used: [] }));
  const res = await c.ai.prepare.mutate({
    text: "what is the answer?",
    actionId: "answer",
    kind: "ask",
  });
  expect(res).toMatchObject({ status: "answered", answer: "Forty-two." });
  await close();
});

test("rename Do then Undo", async () => {
  const { api, c, mk, close } = await setup();
  const item = await mk("Old");
  api.ai.queue(JSON.stringify({ title: "New" }));
  const res = await c.ai.prepare.mutate({
    text: "rename this",
    itemId: item.id,
    actionId: "retitle",
    kind: "do",
  });
  expect(res.status).toBe("applied");
  expect((await c.items.get.query({ id: item.id })).title).toBe("New");
  const undone = await c.ai.undo.mutate({ requestId: res.requestId });
  expect(undone).toEqual({ summary: "Undid rename" });
  expect((await c.items.get.query({ id: item.id })).title).toBe("Old");
  await close();
});

test("apply twice is refused", async () => {
  const { api, c, mk, close } = await setup();
  const item = await mk("Old");
  api.ai.queue(SUGGEST);
  const res = await c.ai.prepare.mutate({
    text: "rename this",
    itemId: item.id,
    actionId: "retitle",
    kind: "suggest",
  });
  expect(res.status).toBe("suggested");
  const first = await c.ai.applyOption.mutate({
    requestId: res.requestId,
    option: 0,
  });
  expect(first.summary).toBeTruthy();
  const second = await failure(
    c.ai.applyOption.mutate({ requestId: res.requestId, option: 0 }),
  );
  expect(second.data?.code).toBe("CONFLICT");
  await close();
});

test("cancel and discard return ok", async () => {
  const { api, c, mk, close } = await setup();
  const item = await mk("Old");
  const run = await c.ai.prepare.mutate({
    text: "rename",
    itemId: item.id,
    actionId: "retitle",
    kind: "do",
    provider: "claude-cli",
  });
  expect(run.status).toBe("run");
  expect(await c.ai.cancel.mutate({ requestId: run.requestId })).toEqual({
    ok: true,
  });
  api.ai.queue(SUGGEST);
  const sug = await c.ai.prepare.mutate({
    text: "rename",
    itemId: item.id,
    actionId: "retitle",
    kind: "suggest",
  });
  expect(await c.ai.discard.mutate({ requestId: sug.requestId })).toEqual({
    ok: true,
  });
  await close();
});

test("provider failures carry data.ai.code", async () => {
  const { api, c, close } = await setup();
  api.ai.queue({ error: "timeout" });
  const err = await failure(
    c.ai.prepare.mutate({ text: "hi", actionId: "answer", kind: "ask" }),
  );
  expect(err.data?.ai?.code).toBe("timeout");
  expect(err.data?.ai?.message).toBeTruthy();
  await close();
});

test("settings round-trip and unknown provider rejected", async () => {
  const { c, close } = await setup();
  const first = await c.ai.settings.get.query();
  expect(first).toMatchObject({
    defaultProvider: "openrouter",
    openrouterModel: null,
    interpreter: "keywords",
  });
  expect(first.providers).toEqual([
    { id: "openrouter", available: true },
    { id: "claude-cli", available: true },
    { id: "codex-cli", available: true },
  ]);
  await c.ai.settings.set.mutate({ defaultProvider: "claude-cli" });
  await c.ai.settings.set.mutate({ openrouterModel: "a/b" });
  expect(await c.ai.settings.get.query()).toMatchObject({
    defaultProvider: "claude-cli",
    openrouterModel: "a/b",
  });
  const bad = await failure(
    c.ai.settings.set.mutate({ defaultProvider: "nope" } as never),
  );
  expect(bad.data?.code).toBe("BAD_REQUEST");
  await close();
});

test("settings.get reports OpenRouter without a key", async () => {
  const { c, close } = await setup({ noOpenRouter: true });
  const s = await c.ai.settings.get.query();
  expect(s.providers[0]).toEqual({
    id: "openrouter",
    available: false,
    reason: "no_key",
  });
  expect(s.providers.slice(1).every((p) => p.available)).toBe(true);
  await close();
});

test("log lists newest first, pages by 50 and flags canUndo", async () => {
  const { api, c, mk, close } = await setup();
  const item = await mk("Old");
  api.ai.queue(JSON.stringify({ title: "New" }));
  const done = await c.ai.prepare.mutate({
    text: "rename",
    itemId: item.id,
    actionId: "retitle",
    kind: "do",
  });
  api.clock.advance(1000);
  for (let i = 0; i < 54; i++) {
    api.ai.queue(JSON.stringify({ answer: "a", used: [] }));
    await c.ai.prepare.mutate({ text: "q", actionId: "answer", kind: "ask" });
    api.clock.advance(1000);
  }
  const page1 = await c.ai.log.list.query({});
  expect(page1.entries).toHaveLength(50);
  expect(Object.keys(page1.entries[0] ?? {}).sort()).toEqual(LOG_FIELDS);
  expect(page1.entries[0]?.interpretedBy).toBeNull();
  expect(page1.nextCursor).not.toBeNull();
  expect(page1.entries[0]).toMatchObject({
    actionId: "answer",
    status: "answered",
    canUndo: false,
  });
  const page2 = await c.ai.log.list.query({
    cursor: page1.nextCursor ?? undefined,
  });
  expect(page2.entries).toHaveLength(5);
  expect(page2.nextCursor).toBeNull();
  const ids = [...page1.entries, ...page2.entries].map((e) => e.id);
  expect(new Set(ids).size).toBe(55);
  const rename = page2.entries.at(-1);
  expect(rename).toMatchObject({
    id: done.requestId,
    status: "applied",
    canUndo: true,
  });
  await c.ai.undo.mutate({ requestId: done.requestId });
  const after = await c.ai.log.list.query({
    cursor: page1.nextCursor ?? undefined,
  });
  expect(after.entries.at(-1)).toMatchObject({
    status: "undone",
    canUndo: false,
  });
  await close();
});

test("log cursor neither skips nor repeats rows sharing a created_at", async () => {
  const { c, db, close } = await setup();
  const at = (s: number) => new Date(Date.UTC(2026, 9, 30, 12, 0, s));
  const row = (createdAt: Date) => ({
    createdAt,
    actionId: "answer",
    kind: "ask",
    provider: "openrouter",
    status: "answered",
  });
  // 2 newer rows, then 50 rows at one instant (the page boundary falls inside
  // that group once the 2 newer rows are taken), then 1 older row.
  const rows = [
    row(at(30)),
    row(at(29)),
    ...Array.from({ length: 50 }, () => row(at(10))),
    row(at(1)),
  ];
  await db.insert(aiRequests).values(rows);
  const page1 = await c.ai.log.list.query({});
  const page2 = await c.ai.log.list.query({
    cursor: page1.nextCursor ?? undefined,
  });
  expect(page1.entries).toHaveLength(50);
  expect(page2.entries).toHaveLength(3);
  expect(page2.nextCursor).toBeNull();
  const all = [...page1.entries, ...page2.entries];
  expect(new Set(all.map((e) => e.id)).size).toBe(53);
  const same = all.filter((e) => e.createdAt === at(10).toISOString());
  expect(same).toHaveLength(50);
  expect(same.map((e) => e.id)).toEqual(
    [...same.map((e) => e.id)].sort().reverse(),
  );
  await close();
});
