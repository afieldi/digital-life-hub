import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  createSdkMcpServer,
  type McpStdioServerConfig,
  type Options,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { describeAction, type RunStart } from "@dlh/agent-protocol";
import {
  clearPending,
  createControl,
  type Outcome,
  type Pending,
  readPending,
} from "./control";
import { createEventSink, type EventSink } from "./events";
import { FORWARDER_PORT } from "./forwarder";
import type { Host } from "./host";
import { Approvals, createCanUseTool, RUNNER_SERVER } from "./permissions";
import { buildPrompt } from "./prompt";
import { createTools } from "./tools";

/** The SDK's `query`, injected so tests run no SDK and no model. */
export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Options;
}) => AsyncIterable<SDKMessage> & { interrupt?(): Promise<unknown> };

export type SessionDeps = {
  query: QueryFn;
  host: Host;
  /** `CLAUDE_CONFIG_DIR`, where the SDK keeps sessions. */
  configDir: string;
  /** `/workspace`: the agent's cwd, its repos and `.dlh/pending.json`. */
  workspace: string;
  currentBranch?: (cwd: string) => string | null;
  /** Extra variables for the SDK child, on top of the container's own. */
  env?: Record<string, string>;
  /** The granted connections' MCP servers, keyed by `mcpServerKey(name)`. */
  mcpServers?: Record<string, McpStdioServerConfig>;
  log?: (line: string) => void;
};

/** The SDK child's model settings (D3): the forwarder, and the relay's placeholder token. */
export const MODEL_ENV = {
  ANTHROPIC_BASE_URL: `http://127.0.0.1:${FORWARDER_PORT}/model`,
  ANTHROPIC_AUTH_TOKEN: "dlh-run",
  // Must be empty, or it would override the token.
  ANTHROPIC_API_KEY: "",
};

/** Long-poll length for `GET /messages`. */
const POLL_SECONDS = 25;
const NO_REPORT = "Ended without a report";
/** How long a report waits for the SDK to stop the turn. */
const INTERRUPT_MS = 5_000;
const FILE_TOOLS = new Set(["Write", "Edit", "MultiEdit", "NotebookEdit"]);

const firstLine = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";

/** The checked-out branch, or null outside a repository or on a detached HEAD. */
export function gitCurrentBranch(cwd: string): string | null {
  try {
    const out = execFileSync(
      "git",
      ["-C", cwd, "symbolic-ref", "--short", "-q", "HEAD"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

/**
 * Whether the SDK kept the session on the volume. It writes each session to
 * `<CLAUDE_CONFIG_DIR>/projects/<project key>/<sessionId>.jsonl`, the key
 * derived from the cwd, so any project directory is looked in.
 */
export function sessionFileExists(configDir: string, sessionId: string) {
  if (!/^[A-Za-z0-9-]+$/.test(sessionId)) return false;
  const projects = join(configDir, "projects");
  try {
    return readdirSync(projects, { withFileTypes: true }).some(
      (d) =>
        d.isDirectory() &&
        existsSync(join(projects, d.name, `${sessionId}.jsonl`)),
    );
  } catch {
    return false;
  }
}

/**
 * The first message of a resumed session (D8): the owner's answer to what the
 * run asked, when the claimed decision answers the pending ask, else
 * "Continue.". An approved action is allowed once: the tool and input hash
 * the API kept with the decision, never `pending.json`'s, which the agent can
 * write and which gives only the wording.
 */
export function resumeMessage(
  start: RunStart,
  pending: Pending | null,
  approvals: Approvals,
): string {
  const d = start.decision;
  if (!d || !pending) return "Continue.";
  // A null seq: the runner stopped before hearing it; the ask was the last thing numbered.
  const answers =
    pending.seq === null ? d.seq === start.lastSeq : d.seq === pending.seq;
  if (!answers) return "Continue.";
  if (pending.kind === "grant") {
    const name =
      start.connections.find((c) => c.id === d.connectionId)?.name ??
      pending.connectionName ??
      pending.action;
    return d.approve ? `Granted: ${name}.` : `Not granted: ${name}.`;
  }
  if (!d.approve) {
    return `Declined: ${pending.action}. Don't do it another way.`;
  }
  if (d.tool && d.inputHash) approvals.allowOnce(d.tool, d.inputHash);
  return `Approved: ${pending.action}. Go ahead.`;
}

const userMessage = (text: string): SDKUserMessage => ({
  type: "user",
  message: { role: "user", content: text },
  parent_tool_use_id: null,
});

/** The SDK's streaming input: messages pushed in order until it's ended. */
class Input implements AsyncIterable<SDKUserMessage> {
  private readonly queue: SDKUserMessage[] = [];
  private ended = false;
  private wake: () => void = () => {};

  push(text: string) {
    if (this.ended) return;
    this.queue.push(userMessage(text));
    this.wake();
  }

  end() {
    this.ended = true;
    this.wake();
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const next = this.queue.shift();
      if (next) yield next;
      else if (this.ended) return;
      else await new Promise<void>((r) => (this.wake = r));
    }
  }
}

const clip = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

/** Assistant text, tool calls (one line each), files written and tool results, as run events. */
function forward(msg: SDKMessage, events: EventSink) {
  if (msg.type === "assistant") {
    for (const b of msg.message.content) {
      if (b.type === "text") {
        events.add("text", { text: b.text });
      } else if (b.type === "tool_use") {
        const input = (b.input ?? {}) as Record<string, unknown>;
        events.add("tool", {
          id: b.id,
          name: b.name,
          action: describeAction(b.name, input),
        });
        if (FILE_TOOLS.has(b.name) && typeof input.file_path === "string") {
          events.add("file", { path: input.file_path });
        }
      }
    }
  } else if (msg.type === "user" && Array.isArray(msg.message.content)) {
    for (const b of msg.message.content) {
      if (b.type !== "tool_result") continue;
      const out =
        typeof b.content === "string"
          ? b.content
          : (b.content ?? [])
              .map((c) => (c.type === "text" ? c.text : ""))
              .join("\n");
      events.add("tool_result", {
        toolUseId: b.tool_use_id,
        isError: b.is_error === true,
        text: clip(out, 2000),
      });
    }
  } else if (msg.type === "result") {
    events.add("status", { result: msg.subtype });
  }
}

/**
 * Drives one Agent SDK session for a container start. It resumes the run's
 * session when the SDK kept it on the volume, sending the owner's answer,
 * else starts fresh with the opening prompt. The person's messages are
 * streamed in as they arrive. The session ends with `finish_task`,
 * `give_up`, a suspend, or a turn that ends with nothing to answer, which
 * fails the run "Ended without a report".
 */
export async function runSession(
  start: RunStart,
  deps: SessionDeps,
): Promise<Outcome> {
  const log = deps.log ?? ((line: string) => console.error(`runner: ${line}`));
  const { host, workspace } = deps;
  const approvals = new Approvals();
  const input = new Input();
  const events = createEventSink(host, log);

  const resume =
    start.sessionId && sessionFileExists(deps.configDir, start.sessionId)
      ? start.sessionId
      : undefined;
  if (resume) {
    input.push(resumeMessage(start, readPending(workspace), approvals));
  } else {
    input.push(buildPrompt(start));
  }
  // Read once; a later start must not answer it again.
  clearPending(workspace);

  // A resumed session keeps its id; the SDK confirms it on its first message.
  let sessionId: string | undefined = resume;
  let announced = false;
  let outcome: Outcome | undefined;
  let session: ReturnType<QueryFn> | undefined;
  const control = createControl({
    host,
    workspace,
    sessionId: () => sessionId,
    events,
    // The run is over for the worker: stop the turn before the tool that
    // reported answers, or the SDK would call the model and run tools again
    // while the container is being stopped.
    onEnd: async (o) => {
      outcome = o;
      if (!session?.interrupt) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        session.interrupt().catch((e) => log(`interrupt: ${firstLine(e)}`)),
        new Promise((r) => {
          timer = setTimeout(r, INTERRUPT_MS);
        }),
      ]);
      clearTimeout(timer);
    },
  });

  const canUseTool = createCanUseTool({
    ctx: {
      connections: start.connections,
      sourceUrl: start.request?.sourceUrl ?? null,
      cwd: workspace,
      currentBranch: deps.currentBranch ?? gitCurrentBranch,
    },
    approvals,
    control,
    events,
    log,
  });

  const stopPolling = new AbortController();
  const polling = (async () => {
    while (!stopPolling.signal.aborted) {
      try {
        const messages = await host.messages(POLL_SECONDS, stopPolling.signal);
        for (const m of messages) input.push(m.body);
      } catch (e) {
        if (stopPolling.signal.aborted) return;
        log(`messages: ${firstLine(e)}`);
        await new Promise((r) => setTimeout(r, 1000));
      }
    }
  })();

  const options: Options = {
    cwd: workspace,
    ...(resume ? { resume } : {}),
    permissionMode: "default",
    canUseTool,
    mcpServers: {
      ...deps.mcpServers,
      [RUNNER_SERVER]: createSdkMcpServer({
        name: RUNNER_SERVER,
        version: "1.0.0",
        tools: createTools({ host, start, workspace, control }),
      }),
    },
    systemPrompt: { type: "preset", preset: "claude_code" },
    // The owner isn't there to answer; the run asks only through the Queue.
    disallowedTools: ["AskUserQuestion"],
    // Connections' servers come only from the runner, never a repo's `.mcp.json`.
    strictMcpConfig: true,
    // No settings files: the workspace is the agent's to write, and an allow
    // rule there would skip `canUseTool`. Only the hook decides.
    settingSources: [],
    env: { ...process.env, ...deps.env, ...MODEL_ENV },
  };

  try {
    session = deps.query({ prompt: input, options });
    for await (const msg of session) {
      if (!announced && msg.session_id) {
        announced = true;
        sessionId = msg.session_id;
        host.session(sessionId).catch((e) => log(`session: ${firstLine(e)}`));
      }
      forward(msg, events);
      if (msg.type !== "result") continue;
      if (control.ending()) {
        input.end();
        continue;
      }
      // The turn ended with no report: answer a waiting message, or end.
      const waiting = await host.messages(0).catch(() => []);
      for (const m of waiting) input.push(m.body);
      if (waiting.length === 0) input.end();
    }
  } catch (e) {
    log(`session: ${firstLine(e)}`);
  } finally {
    // Over: a report from here on has no turn to stop.
    session = undefined;
    stopPolling.abort();
    input.end();
  }
  await polling;
  await control.settled();

  if (!outcome) {
    try {
      await control.fail("no_report", NO_REPORT);
    } catch (e) {
      log(`fail: ${firstLine(e)}`);
    }
  }
  await events.drain();
  return outcome ?? "host_error";
}
