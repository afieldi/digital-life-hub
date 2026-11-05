import type {
  FailRequest,
  FinishRequest,
  HubRequest,
  HubResponse,
  MessagesResponse,
  RunStart,
  SuspendRequest,
} from "@dlh/agent-protocol";
import type { EventBatch, Host } from "../src/host";

/** A run as `GET /run` returns it, with every field filled in. */
export function runStart(overrides: Partial<RunStart> = {}): RunStart {
  return {
    runId: "run-1",
    task: {
      id: "task-1",
      title: "Fix the login redirect",
      notes: "It loops on Safari.",
    },
    request: {
      sender: "Dana",
      body: "Login keeps bouncing me back.",
      source: "slack",
      sourceUrl: "https://acme.slack.com/archives/C024BE91L/p1700000000000100",
    },
    instructions: "Be brief.",
    connections: [
      {
        id: "c1",
        name: "GitHub work",
        type: "github",
        scopeSummary: "repos: acme/web",
      },
      { id: "c2", name: "Slack", type: "slack", scopeSummary: "bot in #eng" },
      { id: "c3", name: "Linear", type: "linear", scopeSummary: "team ENG" },
    ],
    grantedIds: ["c1", "c2"],
    sessionId: null,
    decision: null,
    lastSeq: 0,
    ...overrides,
  };
}

type Message = MessagesResponse["messages"][number];

/** A host that records every call; `messages` hands out `inbox` then waits. */
export function fakeHost(
  opts: { inbox?: Message[]; suspendSeq?: number } = {},
) {
  const inbox = [...(opts.inbox ?? [])];
  const calls = {
    events: [] as EventBatch[],
    hub: [] as HubRequest[],
    suspend: [] as SuspendRequest[],
    finish: [] as FinishRequest[],
    fail: [] as FailRequest[],
    session: [] as string[],
  };
  const host: Host = {
    async run() {
      throw new Error("not used");
    },
    async events(events) {
      calls.events.push(events);
    },
    async messages(waitSeconds, signal) {
      if (inbox.length > 0) return inbox.splice(0);
      if (waitSeconds === 0) return [];
      // Wait until the session ends and aborts the poll.
      await new Promise<void>((resolve) => {
        if (signal?.aborted) resolve();
        signal?.addEventListener("abort", () => resolve());
      });
      return [];
    },
    async hub(req): Promise<HubResponse> {
      calls.hub.push(req);
      return { ok: true, result: { echoed: req.operation } };
    },
    async suspend(req) {
      calls.suspend.push(req);
      return { seq: opts.suspendSeq ?? 5 };
    },
    async finish(req) {
      calls.finish.push(req);
    },
    async fail(req) {
      calls.fail.push(req);
    },
    async session(sessionId) {
      calls.session.push(sessionId);
    },
    async credentials() {
      throw new Error("not used");
    },
  };
  return { host, calls };
}
