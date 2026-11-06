import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HubError, type WorkerApi } from "../src/api";
import type { Docker, RunSpec } from "../src/docker/docker";
import type { Price } from "../src/relay/prices";
import {
  type Claimed,
  type RunHandle,
  startRun,
  type Timers,
} from "../src/run/supervisor";

const RUN = "5b0c6a8e-1d2f-4e3a-9b7c-0123456789ab";
const TASK = "0d3f7c2a-8b1e-4f6a-9c5d-abcdefabcdef";
const GITHUB = "11111111-1111-4111-8111-111111111111";
const AWS = "22222222-2222-4222-8222-222222222222";
const RUN_TOKEN = "run-token-do-not-leak";
const GATEWAY_KEY = "gateway-key-do-not-leak";
const GITHUB_SECRET = "ghp_secret_do_not_leak";
const DIGEST = `sha256:${"b".repeat(64)}`;
const PRICE: Price = {
  input: 0.000004,
  output: 0.00002,
  cacheRead: 0,
  cacheWrite: 0,
};

function claimed(over: Partial<Claimed> = {}): Claimed {
  return {
    run: {
      id: RUN,
      taskId: TASK,
      status: "running",
      sessionId: null,
      workspace: null,
      connectionIds: [GITHUB],
      pending: null,
      decision: null,
      failures: 0,
      heartbeatAt: "2026-11-05T10:00:00.000Z",
      createdAt: "2026-11-05T09:00:00.000Z",
      startedAt: "2026-11-05T10:00:00.000Z",
      finishedAt: null,
      failureCode: null,
      failureMessage: null,
      report: null,
      turns: 3,
      inputTokens: 100,
      outputTokens: 10,
      costUsd: 1.5,
      image: null,
    },
    token: RUN_TOKEN,
    task: { id: TASK, title: "Fix the build", notes: null },
    request: null,
    instructions: "Be brief.",
    connections: [
      { id: GITHUB, name: "gh", type: "github", scopeSummary: "repos: a/b" },
      { id: AWS, name: "prod", type: "aws", scopeSummary: "read only" },
    ],
    connectionIds: [GITHUB],
    sessionId: null,
    decision: null,
    messages: [{ id: "m0", at: "2026-11-05T09:30:00.000Z", body: "hello" }],
    lastSeq: 7,
    ...over,
  };
}

/** Runs registered callbacks only when the test fires their interval. */
function fakeTimers() {
  const live = new Set<{ ms: number; fn: () => void; repeat: boolean }>();
  const timers: Timers = {
    every(ms, fn) {
      const t = { ms, fn, repeat: true };
      live.add(t);
      return () => live.delete(t);
    },
    after(ms, fn) {
      const t = { ms, fn, repeat: false };
      live.add(t);
      return () => live.delete(t);
    },
  };
  const fire = (ms: number) => {
    for (const t of [...live]) {
      if (t.ms !== ms) continue;
      if (!t.repeat) live.delete(t);
      t.fn();
    }
  };
  return { timers, fire };
}

function fakeDocker(opts: { runError?: Error } = {}) {
  let exit: (code: number) => void = () => {};
  const exited = new Promise<{ exitCode: number }>((resolve) => {
    exit = (exitCode) => resolve({ exitCode });
  });
  const specs: RunSpec[] = [];
  const docker = {
    run: vi.fn(async (spec: RunSpec) => {
      specs.push(spec);
      if (opts.runError) throw opts.runError;
      return { containerId: "c1" };
    }),
    stop: vi.fn(async () => exit(143)),
    remove: vi.fn(async () => {}),
    wait: vi.fn(() => exited),
    listRunContainers: vi.fn(async () => []),
    removeVolume: vi.fn(async () => {}),
    imageDigest: vi.fn(async () => DIGEST),
  } satisfies Docker;
  return { docker, specs, exit: (code: number) => exit(code) };
}

/** tRPC's client error for a request that never got an answer. */
const networkError = () =>
  Object.assign(new Error("fetch failed"), { cause: new TypeError("x") });
/** tRPC's client error for an answer from the API. */
const apiError = (code: string) =>
  Object.assign(new Error(code), { data: { code } });

/** A worker mutation's answer: its result, with the undo record it carries. */
const answer = (result: unknown) => ({
  result,
  undo: { calls: [], created: [] },
});

function fakeApi() {
  const mutate = () =>
    vi.fn(async (_input: unknown): Promise<unknown> => answer({}));
  const agent = {
    heartbeat: { mutate: mutate() },
    appendEvents: { mutate: mutate() },
    takeMessages: { mutate: mutate() },
    suspend: { mutate: mutate() },
    finish: { mutate: mutate() },
    fail: { mutate: mutate() },
  };
  agent.heartbeat.mutate.mockResolvedValue(answer({ stop: false }));
  agent.takeMessages.mutate.mockResolvedValue(answer({ messages: [] }));
  const hubCalls: {
    token: string;
    id: string;
    input: unknown;
    kind: string;
  }[] = [];
  let hubAnswer: () => Promise<unknown> = async () => ({ id: "t1" });
  const api = {
    worker: { agent },
    asRun: (token: string) => ({
      call: async (id: string, input: unknown, kind: string) => {
        hubCalls.push({ token, id, input, kind });
        return hubAnswer();
      },
    }),
  } as unknown as WorkerApi;
  return {
    api,
    agent,
    hubCalls,
    answerHub: (fn: () => Promise<unknown>) => {
      hubAnswer = fn;
    },
  };
}

const dirs: string[] = [];
const handles: RunHandle[] = [];
afterEach(async () => {
  for (const h of handles.splice(0)) {
    h.stop("test over");
    await h.done;
  }
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function setup(
  opts: {
    claim?: Partial<Claimed>;
    runError?: Error;
    gateway?: () => Response;
    log?: (line: string) => void;
  } = {},
) {
  // Unix socket paths are short (104 bytes on macOS); /tmp keeps them under it.
  const dataDir = mkdtempSync(
    join(process.platform === "darwin" ? "/tmp" : tmpdir(), "dlh-"),
  );
  dirs.push(dataDir);
  const { timers, fire } = fakeTimers();
  const { docker, specs, exit } = fakeDocker({ runError: opts.runError });
  const { api, agent, hubCalls, answerHub } = fakeApi();
  const store = {
    secretOf: vi.fn((id: string): Record<string, string> => {
      if (id === GITHUB) return { token: GITHUB_SECRET };
      return { accessKeyId: "AKIA", secretAccessKey: "aws-secret" };
    }),
    markStarted: vi.fn(),
    markEnded: vi.fn(),
  };
  const gatewayFetch = vi.fn(
    async (_url: string | URL | Request, _init?: RequestInit) =>
      opts.gateway?.() ??
      new Response(
        JSON.stringify({
          id: "msg",
          usage: { input_tokens: 1000, output_tokens: 100 },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
  );
  const handle = startRun(claimed(opts.claim), {
    api,
    docker,
    store,
    dataDir,
    image: "dlh-agent-runner",
    relay: {
      gatewayUrl: "https://gateway.test/claude-code",
      gatewayKey: GATEWAY_KEY,
      prices: { priceOf: async () => PRICE },
      fetch: gatewayFetch as unknown as typeof fetch,
      retryDelayMs: () => 0,
    },
    timers,
    now: () => new Date("2026-11-05T10:05:00.000Z"),
    log: opts.log ?? (() => {}),
  });
  handles.push(handle);
  const socketPath = join(dataDir, "runs", RUN, "dlh.sock");

  const call = (
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; body: unknown }> =>
    new Promise((resolve, reject) => {
      const req = request(
        {
          socketPath,
          method,
          path,
          headers: { "content-type": "application/json" },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (c) => {
            text += c;
          });
          res.on("end", () => {
            let parsed: unknown = text;
            try {
              parsed = text ? JSON.parse(text) : null;
            } catch {}
            resolve({ status: res.statusCode ?? 0, body: parsed });
          });
        },
      );
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });

  /** Resolves once the container has been started (the socket is up before it). */
  const started = () => vi.waitFor(() => expect(docker.run).toHaveBeenCalled());
  return {
    handle,
    docker,
    specs,
    exit,
    agent,
    hubCalls,
    answerHub,
    store,
    gatewayFetch,
    fire,
    call,
    started,
    socketPath,
    dataDir,
  };
}

const event = (text: string) => ({
  at: "2026-11-05T10:01:00.000Z",
  kind: "text" as const,
  data: { text },
});

// The supervisor serves a Unix socket and sets POSIX modes: the worker runs on Linux.
describe.skipIf(process.platform === "win32")("startRun", () => {
  it("starts the container with only non-secret env and records it", async () => {
    const t = setup();
    await t.started();
    expect(t.specs).toHaveLength(1);
    const spec = t.specs[0] as RunSpec;
    expect(spec.runId).toBe(RUN);
    expect(spec.image).toBe("dlh-agent-runner");
    expect(Object.keys(spec.env).sort()).toEqual([
      "ANTHROPIC_API_KEY",
      "ANTHROPIC_AUTH_TOKEN",
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
      "CLAUDE_CONFIG_DIR",
      "RUN_ID",
    ]);
    const all = JSON.stringify(spec);
    for (const secret of [RUN_TOKEN, GATEWAY_KEY, GITHUB_SECRET]) {
      expect(all).not.toContain(secret);
    }
    expect(t.store.markStarted).toHaveBeenCalledWith(RUN, `dlh-ws-${RUN}`);
  });

  it("serves the run's start on GET /run", async () => {
    const t = setup();
    await t.started();
    const res = await t.call("GET", "/run");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      runId: RUN,
      task: { id: TASK, title: "Fix the build" },
      grantedIds: [GITHUB],
      lastSeq: 7,
      instructions: "Be brief.",
    });
    expect(JSON.stringify(res.body)).not.toContain(RUN_TOKEN);
  });

  it("events are numbered after lastSeq", async () => {
    const t = setup();
    await t.started();
    const res = await t.call("POST", "/events", {
      events: [event("a"), event("b")],
    });
    expect(res.status).toBe(200);
    await t.call("POST", "/events", { events: [event("c")] });
    t.fire(2000);
    await vi.waitFor(() =>
      expect(t.agent.appendEvents.mutate).toHaveBeenCalled(),
    );
    expect(t.agent.appendEvents.mutate).toHaveBeenCalledWith({
      runId: RUN,
      events: [
        { seq: 8, ...event("a") },
        { seq: 9, ...event("b") },
        { seq: 10, ...event("c") },
      ],
    });
  });

  it("a heartbeat counts the claimed cost plus this container's", async () => {
    const t = setup();
    await t.started();
    const model = await t.call("POST", "/model/v1/messages", {
      model: "claude-opus-5-5",
      messages: [],
    });
    expect(model.status).toBe(200);
    const [, init] = t.gatewayFetch.mock.calls[0] ?? [];
    expect(new Headers(init?.headers).get("authorization")).toBe(
      `Bearer ${GATEWAY_KEY}`,
    );
    await t.call("POST", "/session", { sessionId: "sess-1" });

    t.fire(30_000);
    await vi.waitFor(() =>
      expect(t.agent.heartbeat.mutate).toHaveBeenCalledTimes(1),
    );
    expect(t.agent.heartbeat.mutate).toHaveBeenCalledWith({
      runId: RUN,
      turns: 4,
      inputTokens: 1100,
      outputTokens: 110,
      costUsd: expect.closeTo(
        1.5 + 1000 * PRICE.input + 100 * PRICE.output,
        12,
      ),
      image: DIGEST,
      sessionId: "sess-1",
    });

    // Let the first beat finish: a beat still in flight skips the next tick.
    await new Promise((r) => setTimeout(r, 0));
    t.fire(30_000);
    await vi.waitFor(() =>
      expect(t.agent.heartbeat.mutate).toHaveBeenCalledTimes(2),
    );
    // The image goes once; the session id with every beat.
    expect(t.agent.heartbeat.mutate.mock.calls[1]?.[0]).not.toHaveProperty(
      "image",
    );
    expect(t.agent.heartbeat.mutate.mock.calls[1]?.[0]).toMatchObject({
      sessionId: "sess-1",
    });
  });

  it("heartbeat stop stops the container", async () => {
    const t = setup();
    await t.started();
    t.agent.heartbeat.mutate.mockResolvedValue(answer({ stop: true }));
    t.fire(30_000);
    const end = await t.handle.done;
    expect(end.reason).toBe("stopped");
    expect(t.docker.stop).toHaveBeenCalledWith(`dlh-run-${RUN}`);
    expect(t.docker.remove).toHaveBeenCalledWith(`dlh-run-${RUN}`);
    expect(t.store.markEnded).toHaveBeenCalledWith(RUN, expect.any(Date));
    expect(existsSync(t.socketPath)).toBe(false);
  });

  it("a heartbeat error twice stops the container", async () => {
    const t = setup();
    await t.started();
    t.agent.heartbeat.mutate.mockRejectedValue(networkError());
    t.fire(30_000);
    const end = await t.handle.done;
    expect(t.agent.heartbeat.mutate).toHaveBeenCalledTimes(2);
    expect(end.reason).toBe("worker_error");
    expect(t.docker.stop).toHaveBeenCalled();
    expect(t.store.markEnded).toHaveBeenCalled();
    expect(t.agent.fail.mutate).not.toHaveBeenCalled();
  });

  it("an API error from heartbeat stops the container without a retry", async () => {
    const t = setup();
    await t.started();
    t.agent.heartbeat.mutate.mockRejectedValue(apiError("CONFLICT"));
    t.fire(30_000);
    await t.handle.done;
    expect(t.agent.heartbeat.mutate).toHaveBeenCalledTimes(1);
    expect(t.docker.stop).toHaveBeenCalled();
  });

  it("hub calls go out with the run token and only everyone-access ids pass", async () => {
    const t = setup();
    await t.started();
    const ok = await t.call("POST", "/hub", {
      operation: "tasks.create",
      input: { title: "x" },
    });
    expect(ok).toEqual({
      status: 200,
      body: { ok: true, result: { id: "t1" } },
    });
    const query = await t.call("POST", "/hub", {
      operation: "tasks.due",
      input: {},
    });
    expect(query.status).toBe(200);
    expect(t.hubCalls).toEqual([
      {
        token: RUN_TOKEN,
        id: "tasks.create",
        input: { title: "x" },
        kind: "mutation",
      },
      { token: RUN_TOKEN, id: "tasks.due", input: {}, kind: "query" },
    ]);

    for (const operation of [
      "tasks.get",
      "agent.claim",
      "agent.finish",
      "nope.x",
    ]) {
      const res = await t.call("POST", "/hub", { operation, input: {} });
      expect(res.body).toMatchObject({ ok: false, code: "FORBIDDEN" });
    }
    expect(t.hubCalls).toHaveLength(2);

    t.answerHub(async () => {
      throw new HubError("CONFLICT", "Changed since");
    });
    const refused = await t.call("POST", "/hub", {
      operation: "tasks.complete",
      input: {},
    });
    expect(refused.body).toEqual({
      ok: false,
      code: "CONFLICT",
      message: "Changed since",
    });
  });

  it("credentials are refused for a connection the run wasn't granted", async () => {
    const t = setup();
    await t.started();
    const granted = await t.call("GET", "/credentials/github/gh");
    expect(granted).toEqual({
      status: 200,
      body: { secret: { token: GITHUB_SECRET } },
    });
    const refused = await t.call("GET", "/credentials/aws/prod");
    expect(refused.status).toBe(403);
    expect(JSON.stringify(refused.body)).not.toContain("aws-secret");
    const unknown = await t.call("GET", "/credentials/github/other");
    expect(unknown.status).toBe(403);
    expect(t.store.secretOf).toHaveBeenCalledTimes(1);
    expect(t.store.secretOf).toHaveBeenCalledWith(GITHUB);
  });

  it('a budget error fails the run with "AI budget reached"', async () => {
    const t = setup({
      gateway: () =>
        new Response(JSON.stringify({ error: "budget" }), { status: 402 }),
    });
    await t.started();
    const res = await t.call("POST", "/model/v1/messages", {
      model: "claude-opus-5-5",
      messages: [],
    });
    expect(res.status).toBe(402);
    const end = await t.handle.done;
    expect(t.agent.fail.mutate).toHaveBeenCalledWith({
      runId: RUN,
      code: "budget",
      message: "AI budget reached",
    });
    expect(end.reason).toBe("failed");
    expect(t.docker.stop).toHaveBeenCalled();
  });

  it("a container that won't start fails the run", async () => {
    const t = setup({
      runError: new Error(
        "Unable to find image 'dlh-agent-runner:latest' locally\nmore",
      ),
    });
    const end = await t.handle.done;
    expect(t.agent.fail.mutate).toHaveBeenCalledWith({
      runId: RUN,
      code: "docker",
      message:
        "Container didn't start: Unable to find image 'dlh-agent-runner:latest' locally",
    });
    expect(end.reason).toBe("failed");
    expect(t.store.markEnded).toHaveBeenCalled();
    expect(existsSync(t.socketPath)).toBe(false);
  });

  it("messages reach a waiting GET /messages", async () => {
    const t = setup();
    await t.started();
    // Taken at claim, so already queued.
    const first = await t.call("GET", "/messages?wait=25");
    expect(first.body).toEqual({ messages: [{ id: "m0", body: "hello" }] });

    t.agent.takeMessages.mutate.mockResolvedValueOnce(
      answer({
        messages: [{ id: "m1", at: "2026-11-05T10:02:00.000Z", body: "later" }],
      }),
    );
    const waiting = t.call("GET", "/messages?wait=25");
    // Let the long poll reach the worker before the poll fires.
    await new Promise((r) => setTimeout(r, 20));
    t.fire(5000);
    expect((await waiting).body).toEqual({
      messages: [{ id: "m1", body: "later" }],
    });
    expect(t.agent.takeMessages.mutate).toHaveBeenCalledWith({ runId: RUN });
  });

  it("finish flushes events first, then finishes and stops", async () => {
    const t = setup();
    await t.started();
    await t.call("POST", "/events", { events: [event("done soon")] });
    const report = { summary: "Fixed", links: [], filesChanged: [] };
    const res = await t.call("POST", "/finish", { report });
    expect(res.status).toBe(200);
    const end = await t.handle.done;
    expect(end.reason).toBe("finished");
    const appendOrder =
      t.agent.appendEvents.mutate.mock.invocationCallOrder[0] ?? 0;
    const finishOrder = t.agent.finish.mutate.mock.invocationCallOrder[0] ?? 0;
    expect(appendOrder).toBeGreaterThan(0);
    expect(finishOrder).toBeGreaterThan(appendOrder);
    expect(t.agent.finish.mutate).toHaveBeenCalledWith({ runId: RUN, report });
  });

  it("suspend numbers its seq after the events and stops the container", async () => {
    const t = setup();
    await t.started();
    await t.call("POST", "/events", { events: [event("asking")] });
    const res = await t.call("POST", "/suspend", {
      sessionId: "sess-1",
      kind: "grant",
      title: "Use prod",
      body: "Needs AWS",
      connectionId: AWS,
    });
    expect(res).toEqual({ status: 200, body: { seq: 9 } });
    const end = await t.handle.done;
    expect(end.reason).toBe("suspended");
    expect(t.agent.suspend.mutate).toHaveBeenCalledWith({
      runId: RUN,
      seq: 9,
      sessionId: "sess-1",
      kind: "grant",
      title: "Use prod",
      body: "Needs AWS",
      connectionId: AWS,
    });
  });

  it("a container that exits without a report fails the run", async () => {
    const lines: string[] = [];
    const t = setup({ log: (l) => lines.push(l) });
    await t.started();
    t.exit(137);
    const end = await t.handle.done;
    expect(t.agent.fail.mutate).toHaveBeenCalledWith({
      runId: RUN,
      code: "no_report",
      message: "Ended without a report",
    });
    expect(end.reason).toBe("failed");
    expect(lines.join("\n")).toContain("137");
    expect(t.docker.remove).toHaveBeenCalled();
    expect(t.store.markEnded).toHaveBeenCalledTimes(1);
  });

  it("a stop the worker causes does not fail the run", async () => {
    const t = setup();
    await t.started();
    t.handle.stop("shutdown");
    const end = await t.handle.done;
    expect(end.reason).toBe("shutdown");
    expect(t.docker.stop).toHaveBeenCalled();
    expect(t.agent.fail.mutate).not.toHaveBeenCalled();

    const beat = setup();
    await beat.started();
    beat.agent.heartbeat.mutate.mockResolvedValue(answer({ stop: true }));
    beat.fire(30_000);
    expect((await beat.handle.done).reason).toBe("stopped");
    expect(beat.agent.fail.mutate).not.toHaveBeenCalled();
  });

  it("a failed event flush before finish doesn't finish the run", async () => {
    const t = setup();
    await t.started();
    t.agent.appendEvents.mutate.mockRejectedValue(networkError());
    await t.call("POST", "/events", { events: [event("lost?")] });
    const res = await t.call("POST", "/finish", {
      report: { summary: "Fixed", links: [], filesChanged: [] },
    });
    expect(res.status).toBe(502);
    const end = await t.handle.done;
    expect(end.reason).toBe("worker_error");
    // Tried and retried before finish, then again by the last flush at the end.
    expect(t.agent.appendEvents.mutate).toHaveBeenCalledTimes(4);
    expect(t.agent.finish.mutate).not.toHaveBeenCalled();
    expect(t.agent.fail.mutate).not.toHaveBeenCalled();
    expect(t.docker.stop).toHaveBeenCalled();
  });

  it("a failed event flush before a relay failure doesn't fail the run", async () => {
    const t = setup({
      gateway: () => new Response("{}", { status: 402 }),
    });
    await t.started();
    t.agent.appendEvents.mutate.mockRejectedValue(apiError("CONFLICT"));
    await t.call("POST", "/events", { events: [event("x")] });
    await t.call("POST", "/model/v1/messages", { model: "m", messages: [] });
    expect((await t.handle.done).reason).toBe("worker_error");
    expect(t.agent.fail.mutate).not.toHaveBeenCalled();
    expect(t.docker.stop).toHaveBeenCalled();
  });

  it("refuses a body that doesn't match the route", async () => {
    const t = setup();
    await t.started();
    const res = await t.call("POST", "/events", { events: [{ kind: "nope" }] });
    expect(res.status).toBe(400);
    expect((await t.call("GET", "/nowhere")).status).toBe(404);
  });
});
