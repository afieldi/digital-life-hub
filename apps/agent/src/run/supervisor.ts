import { chmodSync, chownSync, mkdirSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import type { RunStart } from "@dlh/agent-protocol";
import { moduleDescriptions } from "@dlh/agent-protocol/modules";
import { accessOf, type OperationDescription } from "@dlh/core";
import type { ClaimResult } from "@dlh/module-agent/server";
import { HubError, type WorkerApi } from "../api";
import {
  containerName,
  type Docker,
  runDir,
  runEnv,
  SOCKET_FILE,
  volumeName,
} from "../docker/docker";
import { createRelay, RelayError } from "../relay/relay";
import type { Store } from "../store";
import { type AssumeRole, secretForRun, stsAssumeRole } from "./credentials";
import { createEventLog, createInbox, realTimers, type Timers } from "./events";
import { createRunServer, type Reply } from "./socket";

/** A claim that got a run. */
export type Claimed = Extract<ClaimResult, { token: string }>;

export type { Timers };

export type RunEnd = {
  runId: string;
  /** `finished`, `failed`, `suspended`, `stopped` (heartbeat), `worker_error`, or what `stop` was given. */
  reason: string;
};

export type RunHandle = {
  runId: string;
  done: Promise<RunEnd>;
  stop(reason: string): void;
};

export type SupervisorDeps = {
  api: Pick<WorkerApi, "worker" | "asRun">;
  docker: Docker;
  store: Pick<Store, "secretOf" | "markStarted" | "markEnded">;
  dataDir: string;
  image: string;
  relay: Parameters<typeof createRelay>[0];
  /** STS for `aws` connections; the real one by default. */
  assumeRole?: AssumeRole;
  timers?: Timers;
  now?: () => Date;
  /** One line per problem; never a secret, the run token or a body. */
  log?: (line: string) => void;
};

const HEARTBEAT_MS = 30_000;
const MESSAGES_MS = 5_000;
const FLUSH_MS = 2_000;
/** The container's user, which alone may reach the run's socket. */
const RUN_UID = 1000;

/** Hub operations a run may call: those whose access is `everyone`, by id. */
const RUN_OPERATIONS = new Map(
  moduleDescriptions
    .flatMap((m) => Object.values(m.operations) as OperationDescription[])
    .filter((op) => accessOf(op) === "everyone")
    .map((op) => [op.id, op.kind] as const),
);

const firstLine = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";

/** An error with no answer from the API behind it (tRPC sets `data` from one). */
const isNetworkError = (e: unknown) =>
  !(typeof e === "object" && e !== null && "data" in e && e.data);

/** A worker call, retried once after a network error (D14). */
async function workerCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    return fn();
  }
}

/** Owner-only, and the container user's when the worker runs as root. */
function lockDown(path: string, mode: number) {
  chmodSync(path, mode);
  if (process.getuid?.() === 0) chownSync(path, RUN_UID, RUN_UID);
}

/**
 * Supervises one claimed run: serves its socket, starts its container, and
 * reports to the API until the run finishes, fails, suspends, exits or is
 * stopped. The container gets no secret; the run token stays here.
 */
export function startRun(claimed: Claimed, deps: SupervisorDeps): RunHandle {
  const runId = claimed.run.id;
  const name = containerName(runId);
  const dir = runDir(deps.dataDir, runId);
  const socketPath = join(dir, SOCKET_FILE);
  const timers = deps.timers ?? realTimers;
  const now = deps.now ?? (() => new Date());
  const log = (line: string) =>
    (deps.log ?? console.error)(`run ${runId}: ${line}`);
  const agent = deps.api.worker.agent;
  const relay = createRelay(deps.relay);

  const events = createEventLog({
    lastSeq: claimed.lastSeq,
    append: (batch) =>
      workerCall(() => agent.appendEvents.mutate({ runId, events: batch })),
  });
  const flush = () =>
    events.flush().catch((e) => log(`appendEvents: ${firstLine(e)}`));

  // Messages taken at claim are already marked delivered, so they go first.
  const inbox = createInbox(
    claimed.messages.map((m) => ({ id: m.id, body: m.body })),
    timers,
  );

  let sessionId: string | undefined;
  let digest: string | undefined;
  let imageSent = false;
  let started = false;
  let ending = false;
  /** A finish, fail or suspend is under way; a second one is refused. */
  let reporting = false;
  /** How the run ends once the finish, fail or suspend under way is answered. */
  let reportEnd: Promise<string> | undefined;
  /** The container exited on its own: there is nothing to stop. */
  let exited = false;
  const cancels: Array<() => void> = [];
  let server: Server | undefined;

  let resolveDone: (end: RunEnd) => void = () => {};
  const done = new Promise<RunEnd>((r) => {
    resolveDone = r;
  });

  /** Stops and removes the container and the socket. `done` always resolves. */
  async function end(reason: string) {
    if (ending) return;
    ending = true;
    try {
      for (const c of cancels.splice(0)) c();
      inbox.close();
      await flush();
      if (started && !exited) {
        await deps.docker.stop(name).catch((e) => log(`stop: ${firstLine(e)}`));
      }
      await deps.docker.remove(name).catch(() => {});
      if (server) {
        const s = server;
        await new Promise<void>((r) => {
          s.close(() => r());
          s.closeAllConnections();
        });
      }
      rmSync(socketPath, { force: true });
      deps.store.markEnded(runId, now());
    } catch (e) {
      log(`end: ${firstLine(e)}`);
    } finally {
      resolveDone({ runId, reason });
    }
  }

  /**
   * Sends the held events, then the report. Events can't be added once the
   * run has ended, so a report goes only after they land; if either call
   * fails (after its one retry) the report isn't sent, and the stale sweep
   * requeues the run, whose resumed session sends again after `lastSeq`.
   * Returns whether the report reached the API.
   */
  async function sendReport(
    what: string,
    call: () => Promise<unknown>,
  ): Promise<boolean> {
    // The usage since the last beat (and the image, for a short run) would
    // be lost: no heartbeat comes after the report.
    await beating;
    try {
      await beat();
    } catch (e) {
      log(`heartbeat before ${what}: ${firstLine(e)}`);
    }
    try {
      await events.flush();
    } catch (e) {
      log(`appendEvents before ${what}: ${firstLine(e)}`);
      return false;
    }
    try {
      await workerCall(call);
      return true;
    } catch (e) {
      log(`${what}: ${firstLine(e)}`);
      return false;
    }
  }

  /** Fails the run through the API, then ends it (D14 if that can't be done). */
  async function failRun(code: string, message: string) {
    if (ending || reporting) return;
    reporting = true;
    reportEnd = sendReport("fail", () =>
      agent.fail.mutate({ runId, code, message }),
    ).then((sent) => (sent ? "failed" : "worker_error"));
    await end(await reportEnd);
  }

  /** Sends the run's totals so far; resolves with whether it should stop. */
  async function beat(): Promise<boolean> {
    const u = relay.usage();
    const image = !imageSent ? digest : undefined;
    const { result } = await workerCall(() =>
      agent.heartbeat.mutate({
        runId,
        turns: claimed.run.turns + u.turns,
        inputTokens: claimed.run.inputTokens + u.inputTokens,
        outputTokens: claimed.run.outputTokens + u.outputTokens,
        costUsd: claimed.run.costUsd + u.costUsd,
        ...(image ? { image } : {}),
        ...(sessionId ? { sessionId } : {}),
      }),
    );
    if (image) imageSent = true;
    return result.stop;
  }

  /** The beat in flight, if any; a tick during it is skipped. */
  let beating: Promise<void> | undefined;
  function heartbeat() {
    if (beating || ending || reporting) return;
    beating = (async () => {
      try {
        if (await beat()) await end("stopped");
      } catch (e) {
        log(`heartbeat: ${firstLine(e)}`);
        await end("worker_error");
      }
    })().finally(() => {
      beating = undefined;
    });
  }

  let polling = false;
  async function pollMessages() {
    if (polling || ending) return;
    polling = true;
    try {
      const { messages } = (
        await workerCall(() => agent.takeMessages.mutate({ runId }))
      ).result;
      inbox.push(messages.map((m) => ({ id: m.id, body: m.body })));
    } catch (e) {
      log(`takeMessages: ${firstLine(e)}`);
    } finally {
      polling = false;
    }
  }

  /** Ends the run once the runner has its answer: a finish, fail or suspend. */
  async function report(
    what: string,
    call: () => Promise<unknown>,
    ok: { body: unknown; reason: string },
  ): Promise<Reply> {
    if (ending || reporting) {
      return { status: 409, body: { error: "Run is ending" } };
    }
    reporting = true;
    reportEnd = sendReport(what, call).then((sent) =>
      sent ? ok.reason : "worker_error",
    );
    if ((await reportEnd) === ok.reason) {
      return { status: 200, body: ok.body, after: () => void end(ok.reason) };
    }
    return {
      status: 502,
      body: { error: `The hub refused ${what}` },
      after: () => void end("worker_error"),
    };
  }

  const start: RunStart = {
    runId,
    task: claimed.task,
    request: claimed.request,
    instructions: claimed.instructions,
    connections: claimed.connections,
    grantedIds: claimed.connectionIds,
    sessionId: claimed.sessionId,
    decision: claimed.decision,
    lastSeq: claimed.lastSeq,
  };

  server = createRunServer(
    {
      run: () => ({ status: 200, body: start }),
      events(body) {
        events.add(body.events);
        return { status: 200, body: {} };
      },
      async messages(waitSeconds, gone) {
        const messages = await inbox.take(waitSeconds, gone);
        return { status: 200, body: { messages } };
      },
      async hub({ operation, input }) {
        const kind = RUN_OPERATIONS.get(operation);
        if (!kind) {
          return {
            status: 200,
            body: {
              ok: false,
              code: "FORBIDDEN",
              message: `A run may not call ${operation}`,
            },
          };
        }
        try {
          const result = await deps.api
            .asRun(claimed.token)
            .call(operation, input, kind);
          return { status: 200, body: { ok: true, result } };
        } catch (e) {
          const code = e instanceof HubError ? e.code : "INTERNAL_SERVER_ERROR";
          const message =
            e instanceof HubError ? e.message : "The hub call failed";
          return { status: 200, body: { ok: false, code, message } };
        }
      },
      async credentials(type, connectionName) {
        const c = claimed.connections.find(
          (x) => x.type === type && x.name === connectionName,
        );
        if (!c || !claimed.connectionIds.includes(c.id)) {
          return {
            status: 403,
            body: { error: `Not granted: ${connectionName}.` },
          };
        }
        let stored: Record<string, string>;
        try {
          stored = deps.store.secretOf(c.id);
        } catch {
          log(`no local secret for connection ${c.id}`);
          return { status: 404, body: { error: "No secret on this host" } };
        }
        try {
          const secret = await secretForRun(
            type,
            stored,
            runId,
            deps.assumeRole ?? stsAssumeRole,
          );
          return { status: 200, body: { secret } };
        } catch (e) {
          // The error's name only: an AWS message can quote the key id.
          const name = e instanceof Error ? e.name : "Error";
          log(`assuming the role of connection ${c.id} failed: ${name}`);
          return {
            status: 502,
            body: { error: `Couldn't assume the role of ${connectionName}` },
          };
        }
      },
      suspend(body) {
        const seq = events.nextSeq();
        sessionId = body.sessionId;
        return report(
          "suspend",
          () => agent.suspend.mutate({ runId, seq, ...body }),
          { body: { seq }, reason: "suspended" },
        );
      },
      finish(body) {
        return report(
          "finish",
          () => agent.finish.mutate({ runId, report: body.report }),
          { body: {}, reason: "finished" },
        );
      },
      fail(body) {
        return report("fail", () => agent.fail.mutate({ runId, ...body }), {
          body: {},
          reason: "failed",
        });
      },
      session(body) {
        sessionId = body.sessionId;
        return { status: 200, body: {} };
      },
      model(req, res) {
        relay.handle(req, res).catch((e: unknown) => {
          if (e instanceof RelayError) void failRun(e.code, e.message);
          else log(`model call: ${firstLine(e)}`);
        });
      },
    },
    log,
  );

  async function boot() {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    lockDown(dir, 0o700);
    rmSync(socketPath, { force: true });
    await new Promise<void>((resolve, reject) => {
      server?.once("error", reject);
      server?.listen(socketPath, () => {
        server?.off("error", reject);
        resolve();
      });
    });
    lockDown(socketPath, 0o600);
    if (ending) {
      // Stopped while the socket was opening, after `end` closed it.
      server?.close();
      rmSync(socketPath, { force: true });
      return;
    }

    cancels.push(
      timers.every(HEARTBEAT_MS, () => void heartbeat()),
      timers.every(MESSAGES_MS, () => void pollMessages()),
      timers.every(FLUSH_MS, () => void flush()),
    );
    deps.store.markStarted(runId, volumeName(runId));
    try {
      await deps.docker.run({ runId, image: deps.image, env: runEnv(runId) });
    } catch (e) {
      await failRun("docker", `Container didn't start: ${firstLine(e)}`);
      return;
    }
    started = true;
    if (ending) {
      // Stopped while the container was starting.
      await deps.docker.stop(name).catch(() => {});
      await deps.docker.remove(name).catch(() => {});
      return;
    }
    deps.docker.imageDigest(deps.image).then(
      (d) => {
        digest = d;
      },
      (e) => log(`image digest: ${firstLine(e)}`),
    );
    deps.docker.wait(name).then(
      ({ exitCode }) => {
        exited = true;
        // Every stop the worker causes sets `ending` first, so this exit is
        // the container's own; without a report it crashed (or hung up early).
        if (ending) return;
        // Exited during (or after) a report: end as that report says, once
        // it's answered; the runner may not be there to hear it.
        if (reportEnd) return reportEnd.then(end);
        log(`container exited (${exitCode}) without a report`);
        return failRun("no_report", "Ended without a report");
      },
      (e) => {
        log(`wait: ${firstLine(e)}`);
        return end("worker_error");
      },
    );
  }

  boot().catch((e) => {
    log(`start: ${firstLine(e)}`);
    void end("worker_error");
  });

  return {
    runId,
    done,
    stop: (reason) => void end(reason),
  };
}
