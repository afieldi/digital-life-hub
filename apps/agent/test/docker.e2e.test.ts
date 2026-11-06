/**
 * The whole path in real Docker: the in-process API, the worker's claim loop,
 * the `dlh-agent-runner` image and the Agent SDK in it, with a scripted fake
 * model behind the relay. Opt-in (`DLH_DOCKER_TESTS=1`, `pnpm test:docker`):
 * it needs Docker, the image (`pnpm agent:image`) and the test Postgres.
 *
 * A run reaches the worker over a Unix socket in a mounted directory, which
 * works only where the worker and the containers share a kernel: on Linux, as
 * root (the worker chowns the socket to the container's user only then). With
 * Docker Desktop, run `pnpm test:docker:linux`, which runs this file in a
 * Linux container inside Docker's VM (see test/docker/in-linux.sh).
 */
import { execFile as nodeExecFile } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { createTestApi, freshModuleDb, serverModules } from "@dlh/api/testing";
import { mintWorkerToken } from "@dlh/server";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { createApi } from "../src/api";
import { createClaimLoop } from "../src/claimLoop";
import { cliDocker, execFile } from "../src/docker/cli";
import { containerName, type Docker, volumeName } from "../src/docker/docker";
import { createPrices } from "../src/relay/prices";
import type { Timers } from "../src/run/events";
import { openStore } from "../src/store";
import {
  fakeAnthropic,
  type ScriptedTurn,
  type SeenRequest,
} from "./fakeAnthropic";

const enabled = process.env.DLH_DOCKER_TESTS === "1";
const IMAGE = process.env.AGENT_RUNNER_IMAGE || "dlh-agent-runner";
const FIREWALL = resolve(__dirname, "../../../deploy/vps/runs-firewall.sh");
const sh = promisify(nodeExecFile);

/** Known values that must never reach a container, its image or the events. */
const GATEWAY_KEY = `sk-e2e-gateway-${randomBytes(8).toString("hex")}`;
const CONNECTION_SECRET = `e2e-connection-${randomBytes(8).toString("hex")}`;
const SECRET_SHA = createHash("sha256").update(CONNECTION_SECRET).digest("hex");
const SECRETS_KEY = randomBytes(32);

const USAGE = { input_tokens: 100, output_tokens: 20 };
const bash = (command: string): ScriptedTurn => ({
  toolUse: { name: "Bash", input: { command, description: "Run it" } },
  usage: USAGE,
});
const finish = (summary: string): ScriptedTurn => ({
  toolUse: {
    name: "mcp__dlh__finish_task",
    input: { summary, links: [] },
  },
  usage: USAGE,
});
/** Proves the env connection reached the agent's shell without printing it. */
const SHOW_SECRET_SHA = 'printf %s "$E2E_SECRET" | sha256sum';

/** The agent's own turns carry its tools; the CLI's side calls don't. */
function isTurn(r: SeenRequest): boolean {
  try {
    const body = JSON.parse(r.body) as { tools?: { name?: string }[] };
    return body.tools?.some((t) => t.name === "Bash") ?? false;
  } catch {
    return false;
  }
}

/** Every 30 s is every 3 s here, so heartbeats and claims come quickly. */
const fastTimers: Timers = {
  every(ms, fn) {
    const t = setInterval(fn, Math.max(ms / 10, 100));
    return () => clearInterval(t);
  },
  after(ms, fn) {
    const t = setTimeout(fn, Math.max(ms / 10, 100));
    return () => clearTimeout(t);
  },
};

/** The Gateway's model list, with one price, for the relay's cost. */
const pricesFetch: typeof fetch = async () =>
  Response.json({
    data: [
      {
        id: "anthropic/claude-opus-5.5",
        pricing: { input: "0.000005", output: "0.000025" },
      },
    ],
  });

async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined | null | false>,
  timeoutMs = 120_000,
): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 250));
  }
}

const docker = async (...args: string[]) =>
  (await sh("docker", args, { maxBuffer: 64 * 1024 * 1024 })).stdout;

/** Where data dirs go: a path the containers' mounts see as the same path. */
const DATA_ROOT = process.env.DLH_E2E_DATA_DIR || tmpdir();

const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const c of cleanups.splice(0).reverse()) await c().catch(() => {});
});

/**
 * A fresh database and API, a fake model playing `script`, and a worker
 * (`newLoop`) as `main.ts` builds it, with fast timers.
 */
async function harness(script: ScriptedTurn[]) {
  const t = await freshModuleDb([...serverModules]);
  cleanups.push(t.close);
  const api = createTestApi({ db: t.db });
  const user = api.client(await api.signIn());
  const workerToken = await mintWorkerToken(t.db);
  mkdirSync(DATA_ROOT, { recursive: true });
  const dataDir = mkdtempSync(join(DATA_ROOT, "w-"));
  cleanups.push(async () => rmSync(dataDir, { recursive: true, force: true }));
  const store = openStore(dataDir, SECRETS_KEY);
  cleanups.push(async () => store.close());
  const fake = await fakeAnthropic(script, { isTurn });
  cleanups.push(fake.close);

  /** Run tokens the API handed the worker, to look for in the container. */
  const runTokens: string[] = [];
  const workerFetch: typeof fetch = async (input, init) => {
    const res = await api.fetch(input, init);
    if (String(input).includes("agent.claim")) {
      const body = (await res.clone().json()) as {
        result?: { data?: { result?: { token?: string } } };
      };
      const token = body.result?.data?.result?.token;
      if (token) runTokens.push(token);
    }
    return res;
  };
  const workerApi = createApi(
    { apiUrl: "http://api.test", workerToken },
    { fetch: workerFetch },
  );

  /** Each container's output and its `docker inspect`, kept before it's removed. */
  const containers: { name: string; logs: string; inspect: string }[] = [];
  const cli = cliDocker(execFile, { dataDir });
  const keptDocker: Docker = {
    ...cli,
    async remove(name) {
      const logs = await sh("docker", ["logs", name]).then(
        (o) => o.stdout + o.stderr,
        () => "",
      );
      const inspect = await docker("inspect", name).catch(() => "");
      if (inspect) containers.push({ name, logs, inspect });
      return cli.remove(name);
    },
  };

  const logs: string[] = [];
  const loops: Array<ReturnType<typeof createClaimLoop>> = [];
  const newLoop = () => {
    const loop = createClaimLoop({
      api: workerApi,
      docker: keptDocker,
      store,
      dataDir,
      image: IMAGE,
      relay: {
        gatewayUrl: fake.url,
        gatewayKey: GATEWAY_KEY,
        prices: createPrices(pricesFetch, Date.now),
      },
      timers: fastTimers,
      log: (line) => logs.push(line),
    });
    loops.push(loop);
    return loop;
  };
  /** The runs made, whose volumes go once the loops have stopped. */
  const runIds: string[] = [];
  cleanups.push(async () => {
    for (const l of loops) await l.stop();
    for (const id of runIds) await docker("volume", "rm", volumeName(id));
  });

  /** A task given to the agent, with `connections` granted. */
  async function agentTask(title: string, connections: string[] = []) {
    const task = (await user.tasks.create.mutate({ title })).result;
    await user.agent.assign.mutate({
      id: task.id,
      expectedUpdatedAt: task.updatedAt,
      connections,
    });
    const { runs } = await user.agent.runs.query({ taskId: task.id });
    const run = runs[0];
    if (!run) throw new Error("assign made no run");
    runIds.push(run.id);
    return { taskId: task.id, runId: run.id };
  }

  const runOf = async (runId: string) => user.agent.run.query({ runId });

  /** Waits for the run to reach `status`; a different end fails at once. */
  const runIn = (runId: string, status: string, timeoutMs?: number) =>
    waitFor(
      `run ${status}`,
      async () => {
        const run = await runOf(runId);
        if (run.status === status) return run;
        if (["done", "failed", "cancelled"].includes(run.status)) {
          throw new Error(
            `run ended ${run.status} (${run.failureCode}: ${run.failureMessage}); worker log:\n${logs.join("\n")}\n${containers.map((c) => `${c.name}:\n${c.logs}`).join("\n")}`,
          );
        }
        return undefined;
      },
      timeoutMs,
    );

  const eventsOf = async (runId: string) =>
    (await user.agent.events.query({ runId })).events;

  /** An env connection, registered with the hub, its secret in the store. */
  async function envConnection(name: string) {
    const { result } = await workerApi.worker.agent.registerConnection.mutate({
      name,
      type: "env",
      scopeSummary: "E2E_SECRET",
    });
    store.addConnection({
      id: result.id,
      name,
      type: "env",
      scopeSummary: "E2E_SECRET",
      secret: { E2E_SECRET: CONNECTION_SECRET },
    });
    return result.id;
  }

  return {
    api,
    user,
    workerToken,
    runTokens,
    fake,
    logs,
    containers,
    newLoop,
    agentTask,
    runOf,
    runIn,
    eventsOf,
    envConnection,
  };
}

/** Releases a held turn. */
function gate() {
  let open: () => void = () => {};
  const opened = new Promise<void>((r) => {
    open = r;
  });
  return { opened, open };
}

describe.skipIf(!enabled)("a run in Docker with a fake model", () => {
  beforeAll(async () => {
    if (process.platform !== "linux") {
      throw new Error(
        "A run's socket can't cross Docker Desktop's VM: run pnpm test:docker:linux",
      );
    }
    const uid = process.getuid?.();
    if (uid !== 0 && uid !== 1000) {
      throw new Error(
        "The worker gives each run's socket to the container's user only as root: sudo -E env \"PATH=$PATH\" pnpm test:docker",
      );
    }
    await docker("image", "inspect", IMAGE).catch(() => {
      throw new Error(`No ${IMAGE} image: run pnpm agent:image first`);
    });
    // Task 11's firewall script makes it on a server; a bare network here.
    await docker("network", "inspect", "dlh-runs").catch(() =>
      docker("network", "create", "dlh-runs"),
    );
  }, 60_000);

  it("a scripted run edits a file, asks to merge, waits, resumes approved and finishes", async () => {
    const h = await harness([
      bash("git init -q /workspace/demo && echo hi > /workspace/demo/a.txt"),
      bash("gh pr merge 1"),
      // Resumed with the approval: the merge is allowed once, then the report.
      bash("gh pr merge 1"),
      finish("Edited a.txt"),
    ]);
    const { taskId, runId } = await h.agentTask("Edit a file and merge");
    await h.newLoop().start();

    const waiting = await h.runIn(runId, "waiting");
    expect(waiting.pending).toMatchObject({ kind: "approval", tool: "Bash" });
    const pending = waiting.pending;
    if (!pending) throw new Error("no pending");
    const { request } = await h.user.requests.get.query({
      id: pending.requestId,
    });
    expect(request.title).toContain("gh pr merge 1");
    expect(request.actions?.map((a) => a.label)).toEqual([
      "Approve",
      "Decline",
    ]);
    // The container ends once the suspend is in.
    await waitFor("the first container", async () => h.containers.length >= 1);

    await h.user.agent.decide.mutate({
      runId,
      seq: pending.seq,
      approve: true,
    });
    const done = await h.runIn(runId, "done");

    expect(done.report).toMatchObject({
      summary: "Edited a.txt",
      filesChanged: ["demo/a.txt"],
    });
    const { task } = await h.user.tasks.get.query({ id: taskId });
    expect(task.completedAt).not.toBeNull();
    // A second container resumed the same session: its first turn carries
    // the first one's history and the answer.
    await waitFor("the second container", async () => h.containers.length >= 2);
    expect(h.containers).toHaveLength(2);
    expect(done.sessionId).toBe(waiting.sessionId);
    expect(done.image).toMatch(/^sha256:/);
    expect(done.turns).toBeGreaterThan(0);
    const resumed = h.fake.turns[2]?.body ?? "";
    expect(resumed).toContain("echo hi > /workspace/demo/a.txt");
    expect(resumed).toContain("Approved: ");
    // The approved merge ran (and failed with no GitHub connection) without a
    // second ask.
    const events = await h.eventsOf(runId);
    expect(events.filter((e) => e.kind === "permission")).toHaveLength(1);
    expect(
      events.filter(
        (e) => e.kind === "tool" && String(e.data.action).includes("gh pr"),
      ),
    ).toHaveLength(2);
  }, 240_000);

  it("a grant request suspends and resumes with the connection", async () => {
    const h = await harness([
      {
        toolUse: {
          name: "mcp__dlh__request_connection",
          input: { name: "e2e-env", reason: "To read the secret" },
        },
        usage: USAGE,
      },
      bash(SHOW_SECRET_SHA),
      finish("Used the connection"),
    ]);
    const connectionId = await h.envConnection("e2e-env");
    const { runId } = await h.agentTask("Use a connection");
    await h.newLoop().start();

    const waiting = await h.runIn(runId, "waiting");
    expect(waiting.pending).toMatchObject({ kind: "grant", connectionId });
    const pending = waiting.pending;
    if (!pending) throw new Error("no pending");
    await h.user.agent.decide.mutate({
      runId,
      seq: pending.seq,
      approve: true,
    });
    const done = await h.runIn(runId, "done");

    expect(done.connectionIds).toContain(connectionId);
    expect(h.fake.turns[1]?.body).toContain("Granted: e2e-env.");
    const results = (await h.eventsOf(runId)).filter(
      (e) => e.kind === "tool_result",
    );
    expect(results.some((e) => String(e.data.text).includes(SECRET_SHA))).toBe(
      true,
    );
  }, 240_000);

  it("a worker restart resumes the run from its session", async () => {
    const held = gate();
    const h = await harness([
      bash("echo one > /workspace/one.txt"),
      // The worker stops during this turn, which never gets its answer.
      { ...bash("echo lost"), hold: held.opened },
      finish("Resumed"),
    ]);
    const { runId } = await h.agentTask("Survive a restart");
    const first = h.newLoop();
    await first.start();

    await waitFor("the held turn", async () => h.fake.turns.length >= 2);
    // A heartbeat has carried the session id, so the next claim can resume it.
    const before = await waitFor("the session id", async () => {
      const run = await h.runOf(runId);
      return run.sessionId ? run : undefined;
    });
    await first.stop();
    held.open();
    const lastSeq = Math.max(0, ...(await h.eventsOf(runId)).map((e) => e.seq));
    expect(lastSeq).toBeGreaterThan(0);

    // No heartbeat for over 2 minutes: the next claim requeues and resumes it.
    h.api.clock.advance(3 * 60_000);
    await h.newLoop().start();
    const done = await h.runIn(runId, "done");

    expect(done.sessionId).toBe(before.sessionId);
    expect(h.fake.turns[2]?.body).toContain("echo one > /workspace/one.txt");
    const seqs = (await h.eventsOf(runId)).map((e) => e.seq);
    expect(seqs.some((s) => s > lastSeq)).toBe(true);
    // One event per number, with none missing.
    expect(seqs).toEqual(seqs.map((_, i) => i + 1));
  }, 240_000);

  it("a turn that ends with no report fails the run", async () => {
    const h = await harness([{ text: "All done, I think.", usage: USAGE }]);
    const { runId } = await h.agentTask("Forget the report");
    await h.newLoop().start();

    const failed = await waitFor("the run to fail", async () => {
      const run = await h.runOf(runId);
      return run.status === "failed" ? run : undefined;
    });
    expect(failed).toMatchObject({
      failureCode: "no_report",
      failureMessage: "Ended without a report",
    });
    const events = await h.eventsOf(runId);
    expect(events.map((e) => e.data.text)).toContain("All done, I think.");
  }, 240_000);

  it("a message sent during a turn is answered before the session ends", async () => {
    const held = gate();
    const h = await harness([
      // Ends with no report, but the message is already queued by then.
      { text: "Looking.", usage: USAGE, hold: held.opened },
      finish("Answered the message"),
    ]);
    const { runId } = await h.agentTask("Listen to me");
    await h.newLoop().start();

    await waitFor("the first turn", async () => h.fake.turns.length >= 1);
    await h.user.agent.message.mutate({ runId, body: "Also check the docs" });
    // The worker takes messages every 0.5 s here and the runner long-polls.
    await new Promise((r) => setTimeout(r, 3000));
    held.open();
    const done = await h.runIn(runId, "done");

    expect(done.report?.summary).toBe("Answered the message");
    expect(h.fake.turns[1]?.body).toContain("Also check the docs");
  }, 240_000);

  it("no secret in the container's config, image or events", async () => {
    const held = gate();
    const h = await harness([
      bash(SHOW_SECRET_SHA),
      // Held while the live container is inspected.
      { ...finish("Kept the secret"), hold: held.opened },
    ]);
    const connectionId = await h.envConnection("e2e-env");
    const { runId } = await h.agentTask("Keep a secret", [connectionId]);
    await h.newLoop().start();

    await waitFor("the second turn", async () => h.fake.turns.length >= 2);
    const live = await docker("inspect", containerName(runId));
    held.open();
    await h.runIn(runId, "done");

    const secrets = [
      GATEWAY_KEY,
      CONNECTION_SECRET,
      h.workerToken,
      ...h.runTokens,
    ];
    expect(h.runTokens.length).toBeGreaterThan(0);
    // The key does reach the model, from the relay.
    expect(h.fake.turns[0]?.headers.authorization).toBe(
      `Bearer ${GATEWAY_KEY}`,
    );
    const history = await docker("history", "--no-trunc", IMAGE);
    const events = JSON.stringify(await h.eventsOf(runId));
    // The secret did reach the agent's shell, as a hash only.
    expect(events).toContain(SECRET_SHA);
    const places = {
      "docker inspect (live)": live,
      ...Object.fromEntries(
        h.containers.flatMap((c, i) => [
          [`docker inspect ${i}`, c.inspect],
          [`docker logs ${i}`, c.logs],
        ]),
      ),
      "docker history": history,
      events,
    };
    for (const [where, text] of Object.entries(places)) {
      for (const secret of secrets) {
        expect(text.includes(secret), `a secret in ${where}`).toBe(false);
      }
    }
    // The container's env is the fixed, non-secret set.
    const [inspected] = JSON.parse(live) as { Config: { Env: string[] } }[];
    expect(inspected?.Config.Env).toContain("ANTHROPIC_API_KEY=");
    expect(inspected?.Config.Env).toContain("ANTHROPIC_AUTH_TOKEN=dlh-run");
  }, 240_000);

  it.skipIf(process.platform !== "linux" || !existsSync(FIREWALL))(
    "a run can't reach the metadata address or the API",
    async () => {
      await sh("sh", [FIREWALL]);
      // A stand-in for the API, on every host address.
      const api = createServer((_q, r) => r.end("api"));
      await new Promise<void>((r) => api.listen(0, "0.0.0.0", r));
      cleanups.push(() => new Promise<void>((r) => api.close(() => r())));
      const { port } = api.address() as AddressInfo;
      const gateway = (
        await docker(
          "network",
          "inspect",
          "dlh-runs",
          "--format",
          "{{(index .IPAM.Config 0).Gateway}}",
        )
      ).trim();
      for (const url of [
        "http://169.254.169.254/latest/meta-data/",
        `http://${gateway}:${port}/`,
      ]) {
        const reached = await sh("docker", [
          "run",
          "--rm",
          "--network",
          "dlh-runs",
          "--entrypoint",
          "curl",
          IMAGE,
          "-sS",
          "--max-time",
          "5",
          url,
        ]).then(
          () => true,
          () => false,
        );
        expect(reached, url).toBe(false);
      }
    },
    60_000,
  );
});
