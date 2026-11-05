import { createHash } from "node:crypto";
import type {
  CanUseTool,
  PermissionResult,
} from "@anthropic-ai/claude-agent-sdk";
import type { RunControl } from "./control";
import type { EventSink } from "./events";

export type Verdict = "alone" | "ask";

export type ClassifyContext = {
  /** Every connection the run can see; MCP servers are keyed by `mcpServerKey(name)`. */
  connections: { name: string; type: string }[];
  /** The request's link, for the Slack rule; null when the task came from none. */
  sourceUrl: string | null;
  /** Where the agent's shell starts. */
  cwd: string;
  /** The checked-out branch in a directory; null when it can't be told. */
  currentBranch: (cwd: string) => string | null;
};

/** The runner's own in-process MCP server. */
export const RUNNER_SERVER = "dlh";

/** The MCP server key (and tool-name prefix) for a connection's name. */
export const mcpServerKey = (name: string) =>
  name.replace(/[^A-Za-z0-9_-]/g, "_");

/** Built-in tools that act inside the container (Bash is checked on its own). */
const BUILT_IN = new Set([
  "Agent",
  "Task",
  "TaskOutput",
  "TaskStop",
  "KillShell",
  "BashOutput",
  "Monitor",
  "Read",
  "Write",
  "Edit",
  "MultiEdit",
  "NotebookEdit",
  "Glob",
  "Grep",
  "LS",
  "TodoWrite",
  "TaskCreate",
  "TaskGet",
  "TaskUpdate",
  "TaskList",
  "ToolSearch",
  "Skill",
  "ListMcpResourcesTool",
  "ReadMcpResourceTool",
  "WebFetch",
  "WebSearch",
]);

const RUNNER_TOOLS = new Set(["finish_task", "give_up", "request_connection"]);
const READ_VERBS = new Set(["get", "list", "search", "read", "fetch"]);
const POST_VERBS = new Set(["post", "send", "reply", "postmessage"]);
const MAIN = new Set(["main", "master"]);

/** `https://x.slack.com/archives/C024BE91L/p17…` → `C024BE91L`. */
export function slackChannelOf(sourceUrl: string | null): string | null {
  return sourceUrl
    ? (/\/archives\/([^/?#]+)/.exec(sourceUrl)?.[1] ?? null)
    : null;
}

/**
 * Whether the agent may use a tool alone or must ask the owner first. The
 * hook is a guide: each connection's credential scope is the real limit.
 */
export function classify(
  tool: string,
  input: Record<string, unknown>,
  ctx: ClassifyContext,
): Verdict {
  const own = tool.startsWith(`mcp__${RUNNER_SERVER}__`)
    ? tool.slice(`mcp__${RUNNER_SERVER}__`.length)
    : tool;
  if (own.startsWith("hub__") || RUNNER_TOOLS.has(own)) return "alone";
  if (tool === "Bash") {
    return typeof input.command === "string" && bashAsks(input.command, ctx)
      ? "ask"
      : "alone";
  }
  if (BUILT_IN.has(tool)) return "alone";
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp) return classifyMcp(mcp[1] ?? "", mcp[2] ?? "", input, ctx);
  return "ask";
}

/** `slack_post_message`, `postMessage` → `["slack", "post", "message"]`. */
const words = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/[_\-.]+/)
    .filter(Boolean);

function classifyMcp(
  server: string,
  name: string,
  input: Record<string, unknown>,
  ctx: ClassifyContext,
): Verdict {
  const connection = ctx.connections.find(
    (c) => mcpServerKey(c.name) === server,
  );
  if (!connection) return "ask";
  const w = words(name);
  // A tool named after its service (`slack_list_channels`) reads by its second word.
  const verb = w[0] === connection.type.toLowerCase() ? w[1] : w[0];
  if (verb && READ_VERBS.has(verb)) return "alone";

  if (connection.type === "slack" && w.some((x) => POST_VERBS.has(x))) {
    const channel = input.channel_id ?? input.channel ?? input.channelId;
    const source = slackChannelOf(ctx.sourceUrl);
    if (source && channel === source) return "alone";
  }
  return "ask";
}

// ---------------------------------------------------------------- shell

const SEPARATORS = new Set(["&&", "||", ";", "|", "&", "\n", "(", ")"]);

/**
 * Splits a shell command into words, keeping quoted parts whole and the
 * control operators (`&&`, `;`, `|`, `$(`…) as their own words. Good enough
 * to find a command's arguments; not a shell.
 */
function tokenize(command: string): string[] {
  const out: string[] = [];
  let word = "";
  let inWord = false;
  const flush = () => {
    if (inWord) out.push(word);
    word = "";
    inWord = false;
  };
  for (let i = 0; i < command.length; i++) {
    const c = command[i] ?? "";
    const two = command.slice(i, i + 2);
    if (c === "'") {
      const close = command.indexOf("'", i + 1);
      const end = close === -1 ? command.length : close;
      word += command.slice(i + 1, end);
      inWord = true;
      i = end;
    } else if (c === '"') {
      inWord = true;
      for (i++; i < command.length && command[i] !== '"'; i++) {
        if (command[i] === "\\" && i + 1 < command.length) i++;
        word += command[i];
      }
    } else if (c === "\\" && i + 1 < command.length) {
      word += command[++i];
      inWord = true;
    } else if (two === "&&" || two === "||" || two === "$(") {
      flush();
      out.push(two === "$(" ? "(" : two);
      i++;
    } else if (";|&()\n`".includes(c)) {
      flush();
      out.push(c === "`" ? "(" : c);
    } else if (/\s/.test(c)) {
      flush();
    } else {
      word += c;
      inWord = true;
    }
  }
  flush();
  return out;
}

/** Each simple command's words, in order. */
function commands(command: string): string[][] {
  const out: string[][] = [[]];
  for (const t of tokenize(command)) {
    if (SEPARATORS.has(t)) out.push([]);
    else out.at(-1)?.push(t);
  }
  return out.filter((c) => c.length > 0);
}

const base = (word: string) => word.split("/").at(-1) ?? word;

function bashAsks(command: string, ctx: ClassifyContext, depth = 0): boolean {
  let cwd = ctx.cwd;
  for (const words of commands(command)) {
    // Leading `VAR=value`, `env`, `sudo`, `time`, `command`, `exec`, `nohup`.
    let i = 0;
    while (
      i < words.length &&
      (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i] ?? "") ||
        ["env", "sudo", "time", "command", "exec", "nohup"].includes(
          words[i] ?? "",
        ))
    ) {
      i++;
    }
    const [cmd = "", ...args] = words.slice(i);
    const name = base(cmd);
    if (name === "cd" && args[0]) {
      cwd = args[0].startsWith("/") ? args[0] : `${cwd}/${args[0]}`;
    } else if (["sh", "bash", "zsh", "dash"].includes(name)) {
      const c = args.indexOf("-c");
      const script = c >= 0 ? args[c + 1] : undefined;
      if (script && depth < 3 && bashAsks(script, { ...ctx, cwd }, depth + 1)) {
        return true;
      }
    } else if (name === "eval" && depth < 3) {
      if (bashAsks(args.join(" "), { ...ctx, cwd }, depth + 1)) return true;
    } else if (name === "git" && gitPushAsks(args, cwd, ctx)) {
      return true;
    } else if (name === "gh" && ghAsks(args)) {
      return true;
    }
  }
  return false;
}

/** git's own options before the subcommand that take a value. */
const GIT_VALUE_OPTIONS = new Set([
  "-C",
  "-c",
  "--git-dir",
  "--work-tree",
  "--namespace",
]);
/** `git push` options that take a separate value. */
const PUSH_VALUE_OPTIONS = new Set([
  "-o",
  "--push-option",
  "--repo",
  "--receive-pack",
  "--exec",
]);

const branchOf = (ref: string) => ref.replace(/^refs\/heads\//, "");

function gitPushAsks(
  args: string[],
  cwd: string,
  ctx: ClassifyContext,
): boolean {
  let i = 0;
  let dir = cwd;
  while (i < args.length && args[i]?.startsWith("-")) {
    const opt = args[i] ?? "";
    if (opt === "-C" && args[i + 1]) {
      const d = args[i + 1] ?? "";
      dir = d.startsWith("/") ? d : `${dir}/${d}`;
    }
    i += GIT_VALUE_OPTIONS.has(opt) ? 2 : 1;
  }
  if (args[i] !== "push") return false;

  const positional: string[] = [];
  let everything = false;
  for (let j = i + 1; j < args.length; j++) {
    const a = args[j] ?? "";
    if (a === "--all" || a === "--mirror") everything = true;
    else if (PUSH_VALUE_OPTIONS.has(a)) j++;
    else if (!a.startsWith("-") || a === "-") positional.push(a);
  }
  if (everything) return true;

  const current = () => ctx.currentBranch(dir);
  const refspecs = positional.slice(1);
  if (refspecs.length === 0) {
    // `git push [remote]` pushes the current branch to its namesake.
    const branch = current();
    return branch === null || MAIN.has(branch);
  }
  return refspecs.some((spec) => {
    const s = spec.replace(/^\+/, "");
    const colon = s.indexOf(":");
    let dst = colon >= 0 ? s.slice(colon + 1) : s;
    if (dst === "HEAD" || dst === "@") {
      const branch = current();
      if (branch === null) return true;
      dst = branch;
    }
    return MAIN.has(branchOf(dst));
  });
}

function ghAsks(args: string[]): boolean {
  // `-R owner/repo` (gh's repository flag) takes a value; it isn't a subcommand.
  const positional = args.filter(
    (a, k) =>
      !a.startsWith("-") && args[k - 1] !== "-R" && args[k - 1] !== "--repo",
  );
  if (positional[0] === "pr" && positional[1] === "merge") return true;
  if (positional[0] !== "api") return false;
  if (args.some((a) => /\/merge\b/.test(a) || /mergePullRequest/.test(a))) {
    return true;
  }
  let method = "";
  args.forEach((a, k) => {
    if (a === "-X" || a === "--method") method = args[k + 1] ?? "";
    else if (a.startsWith("--method=")) method = a.slice("--method=".length);
    else if (/^-X./.test(a)) method = a.slice(2);
  });
  return (
    ["PUT", "POST"].includes(method.toUpperCase()) &&
    args.some((a) => /(^|\/)pulls(\/|$)/.test(a))
  );
}

// ---------------------------------------------------------------- approvals

/** JSON with every object's keys sorted, so equal inputs hash equal. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** sha256 of the tool's name and its input as canonical JSON. */
export function inputHash(tool: string, input: unknown): string {
  return createHash("sha256")
    .update(`${tool}\n${canonical(input)}`)
    .digest("hex");
}

/** Actions the owner approved, each allowed once, matched on tool and input hash. */
export class Approvals {
  private readonly allowed = new Set<string>();

  allowOnce(tool: string, hash: string) {
    this.allowed.add(`${tool}\n${hash}`);
  }

  take(tool: string, hash: string): boolean {
    return this.allowed.delete(`${tool}\n${hash}`);
  }
}

const MAX_ACTION = 500;

/** The action quoted to the owner: the tool and its input, at most 500 characters. */
export function describeAction(
  tool: string,
  input: Record<string, unknown>,
): string {
  const what =
    tool === "Bash" && typeof input.command === "string"
      ? input.command
      : canonical(input);
  const line = `${tool}: ${what}`;
  return line.length <= MAX_ACTION ? line : `${line.slice(0, MAX_ACTION - 1)}…`;
}

const short = (s: string, n: number) =>
  s.length <= n ? s : `${s.slice(0, n - 1)}…`;

/**
 * The SDK's permission hook. Alone, or an approval taken, is allowed. An ask
 * writes `pending.json`, suspends the run with an approval request quoting
 * the action, and denies with `interrupt`, which ends the session: the
 * container stops and the owner's answer resumes it.
 */
export function createCanUseTool(deps: {
  ctx: ClassifyContext;
  approvals: Approvals;
  control: RunControl;
  events: EventSink;
  log: (line: string) => void;
}): CanUseTool {
  return async (tool, input): Promise<PermissionResult> => {
    if (classify(tool, input, deps.ctx) === "alone") {
      return { behavior: "allow", updatedInput: input };
    }
    const hash = inputHash(tool, input);
    if (deps.approvals.take(tool, hash)) {
      return { behavior: "allow", updatedInput: input };
    }
    if (deps.control.ending()) {
      return {
        behavior: "deny",
        message: "The run is ending.",
        interrupt: true,
      };
    }
    const action = describeAction(tool, input);
    deps.events.add("permission", { tool, action });
    try {
      await deps.control.suspend({
        kind: "approval",
        title: `Approve: ${short(action, 120)}`,
        body: action,
        tool,
        inputHash: hash,
        action,
      });
    } catch (e) {
      deps.log(`suspend failed: ${e instanceof Error ? e.message : String(e)}`);
      return {
        behavior: "deny",
        message: "Couldn't ask the owner; the run is stopping.",
        interrupt: true,
      };
    }
    return {
      behavior: "deny",
      message:
        "This needs the owner's approval. The run is paused until they answer.",
      interrupt: true,
    };
  };
}
