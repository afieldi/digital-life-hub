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

/** The tokenizer's word for `$(` or a backtick. */
const SUBST = "\u0000subst";
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
      out.push(two === "$(" ? SUBST : two);
      i++;
    } else if (";|&()\n`".includes(c)) {
      flush();
      out.push(c === "`" ? SUBST : c);
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
    // A substitution's output becomes the outer command's arguments: mark it,
    // so they read as unknown, then scan the substitution as its own command.
    if (t === SUBST) out.at(-1)?.push("$(");
    if (t === SUBST || SEPARATORS.has(t)) out.push([]);
    else out.at(-1)?.push(t);
  }
  return out.filter((c) => c.length > 0);
}

const base = (word: string) => word.split("/").at(-1) ?? word;

/** Shell words that start a compound command; the command proper follows. */
const RESERVED = new Set([
  "if",
  "then",
  "elif",
  "else",
  "do",
  "while",
  "until",
  "!",
  "{",
  "}",
]);

/**
 * Commands that run the next word as a command, with their options that take
 * a value. `timeout` also takes a duration before the command.
 */
const WRAPPERS: Record<string, string[]> = {
  env: ["-u", "--unset", "-C", "--chdir", "-S", "--split-string"],
  sudo: ["-u", "-g", "-C", "-D", "-h", "-p", "-U"],
  time: ["-f", "-o"],
  command: [],
  exec: ["-a"],
  nohup: [],
  timeout: ["-s", "--signal", "-k", "--kill-after"],
  nice: ["-n", "--adjustment"],
  ionice: ["-c", "--class", "-n", "--classdata", "-p", "--pid"],
  stdbuf: ["-i", "-o", "-e", "--input", "--output", "--error"],
  xargs: [
    "-I",
    "-n",
    "-P",
    "-d",
    "-L",
    "-s",
    "-E",
    "-a",
    "--max-args",
    "--max-procs",
    "--delimiter",
  ],
};

/**
 * The index of the command word, past assignments, reserved words and
 * wrappers, and whether `xargs` adds arguments the command line doesn't show.
 */
function commandStart(words: string[]): { i: number; appends: boolean } {
  let i = 0;
  let appends = false;
  while (i < words.length) {
    const w = words[i] ?? "";
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w) || RESERVED.has(w)) {
      i++;
      continue;
    }
    const valued = WRAPPERS[base(w)];
    if (!valued) break;
    if (base(w) === "xargs") appends = true;
    i++;
    while (i < words.length && (words[i] ?? "").startsWith("-")) {
      i += valued.includes(words[i] ?? "") ? 2 : 1;
    }
    if (base(w) === "timeout") i++;
  }
  return { i, appends };
}

/** `-c`, `-lc`, `-ec`…: a shell's option cluster that runs the next word. */
const isDashC = (a: string) => /^-[A-Za-z]*c[A-Za-z]*$/.test(a);

/** What the parser made of a command's pushes: asks, or how many it cleared. */
type ShellScan = { ask: boolean; clearedPushes: number };

function scan(command: string, ctx: ClassifyContext, depth: number): ShellScan {
  const out: ShellScan = { ask: false, clearedPushes: 0 };
  let cwd = ctx.cwd;
  for (const words of commands(command)) {
    const start = commandStart(words);
    const [cmd = "", ...args] = words.slice(start.i);
    const name = base(cmd);
    let inner: string | undefined;
    if (name === "cd" && args[0]) {
      cwd = args[0].startsWith("/") ? args[0] : `${cwd}/${args[0]}`;
    } else if (["sh", "bash", "zsh", "dash"].includes(name)) {
      const c = args.findIndex(isDashC);
      inner = c >= 0 ? args[c + 1] : undefined;
    } else if (name === "eval") {
      inner = args.join(" ");
    } else if (name === "git") {
      const push = gitPush(args, cwd, ctx);
      if (push === "ask" || (push === "clear" && start.appends)) out.ask = true;
      else if (push === "clear") out.clearedPushes++;
    } else if (name === "gh" && ghAsks(args)) {
      out.ask = true;
    }
    if (inner !== undefined) {
      if (depth >= 3) {
        out.ask = true;
      } else {
        const s = scan(inner, { ...ctx, cwd }, depth + 1);
        out.ask ||= s.ask;
        out.clearedPushes += s.clearedPushes;
      }
    }
  }
  return out;
}

/**
 * A shell command asks when it merges or pushes to `main`. What the parser
 * can't read fails safe: a command that mentions more pushes than the parser
 * cleared as non-main asks, and so does any `gh … merge`.
 */
function bashAsks(command: string, ctx: ClassifyContext): boolean {
  const s = scan(command, ctx, 0);
  if (s.ask) return true;
  if (/\bgh\b[\s\S]*\bmerge\b/.test(command)) return true;
  if (/\bgit\b[\s\S]*\bpush\b/.test(command)) {
    const mentioned = command.match(/\bpush\b/g)?.length ?? 0;
    return s.clearedPushes < mentioned;
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

/** `refs/heads/main` and `heads/main` are `main` to git. */
const branchOf = (ref: string) => ref.replace(/^(refs\/)?heads\//, "");

/**
 * Shell expansion (`$(` and a backtick read as `$(`), or a glob: the word
 * isn't what git or gh will see.
 */
const UNREADABLE = /[$`*?[]/;

/** A `git` command: not a push, a push that asks, or a push cleared as non-main. */
function gitPush(
  args: string[],
  cwd: string,
  ctx: ClassifyContext,
): "none" | "ask" | "clear" {
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
  // `git $(printf pu; printf sh) …` could be a push.
  if (UNREADABLE.test(args[i] ?? "")) return "ask";
  if (args[i] !== "push") return "none";

  const positional: string[] = [];
  let everything = false;
  for (let j = i + 1; j < args.length; j++) {
    const a = args[j] ?? "";
    if (a === "--all" || a === "--mirror") everything = true;
    else if (PUSH_VALUE_OPTIONS.has(a)) j++;
    else if (!a.startsWith("-") || a === "-") positional.push(a);
  }
  if (everything || positional.some((p) => UNREADABLE.test(p))) return "ask";

  const current = () => ctx.currentBranch(dir);
  const refspecs = positional.slice(1);
  const toMain = (spec: string) => {
    const s = spec.replace(/^\+/, "");
    const colon = s.indexOf(":");
    const dst = colon >= 0 ? s.slice(colon + 1) : s;
    // `git push [remote]` and `HEAD` push the current branch to its namesake.
    if (dst === "HEAD" || dst === "@" || dst === "") {
      const branch = current();
      return branch === null || MAIN.has(branch);
    }
    return MAIN.has(branchOf(dst));
  };
  const asks = refspecs.length === 0 ? toMain("HEAD") : refspecs.some(toMain);
  return asks ? "ask" : "clear";
}

function ghAsks(args: string[]): boolean {
  // `-R owner/repo` (gh's repository flag) takes a value; it isn't a subcommand.
  const positional = args.filter(
    (a, k) =>
      !a.startsWith("-") && args[k - 1] !== "-R" && args[k - 1] !== "--repo",
  );
  // `gh pr $(…)` could be a merge.
  const [sub = "", verb = ""] = positional;
  if (UNREADABLE.test(sub)) return true;
  if (sub === "pr" && (verb === "merge" || UNREADABLE.test(verb))) return true;
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

/**
 * The part of a tool's input that says what it does. A model re-issuing an
 * approved Bash call words its `description` (and may pick a `timeout`)
 * anew, so only the command and whether it runs in the background count.
 */
function whatItDoes(tool: string, input: unknown): unknown {
  if (tool !== "Bash" || !input || typeof input !== "object") return input;
  const { command, run_in_background } = input as Record<string, unknown>;
  return {
    command,
    ...(run_in_background === true ? { run_in_background } : {}),
  };
}

/** sha256 of the tool's name and what its input does, as canonical JSON. */
export function inputHash(tool: string, input: unknown): string {
  return createHash("sha256")
    .update(`${tool}\n${canonical(whatItDoes(tool, input))}`)
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
