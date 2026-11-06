import { execFile } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { McpStdioServerConfig } from "@anthropic-ai/claude-agent-sdk";
import type { RunStart } from "@dlh/agent-protocol";
import { mcpServerKey } from "./permissions";

/** `GET /credentials/:type/:name` over the run's socket: refused unless granted. */
export type FetchSecret = (
  type: string,
  name: string,
) => Promise<Record<string, string>>;

/**
 * How a run's granted connections reach the agent (D5). Nothing here but
 * `env` carries a secret, and `env` goes only to the SDK child.
 */
export type Wiring = {
  /** Keyed by `mcpServerKey(name)`; each starts the launcher, which fetches its secret. */
  mcpServers: Record<string, McpStdioServerConfig>;
  /** For the SDK's `env` option only: `env` connections' values, and the settings below. */
  env: Record<string, string>;
  /** Git settings, passed to git as `GIT_CONFIG_*` in `env`. */
  gitConfig: Record<string, string>;
  /** `owner/repo`s cloned into `/workspace/<repo>` when missing. */
  clone: string[];
  /** `~/.aws/config` content, or null with no AWS connection granted. */
  awsConfig: string | null;
};

/** The command that starts a connection's MCP server: `<launcher> <type> <name>`. */
export const MCP_LAUNCHER = { command: "node", args: ["/opt/runner/mcp.js"] };
/** The pinned MCP servers installed in the image. */
export const MCP_BIN = "/opt/mcp/node_modules/.bin";
const MCP_TYPES = new Set(["slack", "linear", "gdrive", "mcp"]);

/** `repos: owner/a, owner/b` → `["owner/a", "owner/b"]`; anything that isn't a plain pair is dropped. */
export function reposOf(scopeSummary: string): string[] {
  const list = /repos:\s*([^;\n]*)/i.exec(scopeSummary)?.[1] ?? "";
  const part = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;
  return list.split(/[\s,]+/).filter((r) => {
    const [owner, repo, more] = r.split("/");
    return (
      more === undefined &&
      !!owner &&
      !!repo &&
      part.test(owner) &&
      part.test(repo) &&
      repo !== ".."
    );
  });
}

/** Single-quoted for a POSIX shell, and for `credential_process`'s shlex split. */
const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

function awsConfigFor(names: string[]): string | null {
  if (names.length === 0) return null;
  const line = (name: string) =>
    `credential_process = dlh-credential aws ${shellQuote(name)}`;
  const first = names[0] as string;
  return [
    `[default]\n${line(first)}`,
    ...names.map((n) => `[profile ${mcpServerKey(n)}]\n${line(n)}`),
  ]
    .join("\n\n")
    .concat("\n");
}

const byName = <T extends { name: string }>(a: T, b: T) =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * Wires the run's granted connections (P6: one not granted isn't wired, and
 * the agent can ask for it with `request_connection`). Only `env` secrets are
 * fetched here; GitHub, AWS and the MCP servers fetch theirs on use.
 */
export async function wireConnections(
  start: RunStart,
  fetchSecret: FetchSecret,
  opts: {
    workspace: string;
    launcher?: { command: string; args: string[] };
  },
): Promise<Wiring> {
  const launcher = opts.launcher ?? MCP_LAUNCHER;
  const granted = new Set(start.grantedIds);
  // Names never hold a control character: they go into a config file.
  const live = start.connections
    .filter((c) => granted.has(c.id) && !/[\p{Cc}]/u.test(c.name))
    .sort(byName);
  const ofType = (type: string) => live.filter((c) => c.type === type);

  const env: Record<string, string> = {};
  for (const c of ofType("env"))
    Object.assign(env, await fetchSecret("env", c.name));

  const mcpServers: Record<string, McpStdioServerConfig> = {};
  for (const c of live.filter((x) => MCP_TYPES.has(x.type))) {
    mcpServers[mcpServerKey(c.name)] = {
      type: "stdio",
      command: launcher.command,
      args: [...launcher.args, c.type, c.name],
    };
  }

  // The first granted GitHub connection by name serves git and gh.
  const github = ofType("github")[0];
  const gitConfig: Record<string, string> = github
    ? { "credential.helper": "!dlh-credential git" }
    : {};
  const aws = ofType("aws").map((c) => c.name);
  const awsConfig = awsConfigFor(aws);

  // Set after `env` connections, so one can't replace them.
  const keys = Object.entries(gitConfig);
  Object.assign(env, {
    GIT_CONFIG_COUNT: String(keys.length),
    ...Object.fromEntries(
      keys.flatMap(([k, v], i) => [
        [`GIT_CONFIG_KEY_${i}`, k],
        [`GIT_CONFIG_VALUE_${i}`, v],
      ]),
    ),
    ...(github ? { DLH_GITHUB_CONNECTION: github.name } : {}),
    ...(awsConfig
      ? { AWS_CONFIG_FILE: join(opts.workspace, ".aws", "config") }
      : {}),
  });

  return {
    mcpServers,
    env,
    gitConfig,
    clone: github ? reposOf(github.scopeSummary) : [],
    awsConfig,
  };
}

/** JSON.parse, its error free of the text (V8 quotes it, and it can be a secret). */
function parseJson(text: string, what: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${what} is not JSON`);
  }
}

/** An `mcp` connection's `args`: a JSON array, or words split on spaces. */
function argsOf(raw: string | undefined): string[] {
  const s = (raw ?? "").trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    const parsed = parseJson(s, "args");
    if (!Array.isArray(parsed)) throw new Error("args is not a list");
    return parsed.map(String);
  }
  return s.split(/\s+/);
}

function envOf(raw: string | undefined): Record<string, string> {
  const parsed = parseJson(raw?.trim() || "{}", "env");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("env is not an object");
  }
  return Object.fromEntries(
    Object.entries(parsed).map(([k, v]) => [k, String(v)]),
  );
}

/** What a third-party server may see of the launcher's environment. */
const SERVER_ENV = new Set(["PATH", "HOME", "TMPDIR", "LANG"]);

/**
 * A connection's MCP server's environment: a minimal base and its own
 * variables. The launcher inherits the SDK child's, which holds every `env`
 * connection's secret; a third-party server gets none of it.
 */
export function serverEnv(
  parent: NodeJS.ProcessEnv,
  own: Record<string, string>,
): Record<string, string> {
  const base = Object.entries(parent).filter(
    (e): e is [string, string] =>
      e[1] !== undefined && (SERVER_ENV.has(e[0]) || e[0].startsWith("NODE_")),
  );
  return { ...Object.fromEntries(base), ...own };
}

export type LaunchSpec = {
  command: string;
  args: string[];
  /** The server process's own variables, its token among them. */
  env: Record<string, string>;
};

/**
 * What the launcher starts for a connection, its secret fetched now from the
 * socket. The token goes only into that process's environment.
 */
export async function launchSpec(
  type: string,
  name: string,
  fetchSecret: FetchSecret,
): Promise<LaunchSpec> {
  const secret = await fetchSecret(type, name);
  const token = secret.token ?? "";
  switch (type) {
    case "slack":
      return {
        command: `${MCP_BIN}/slack-mcp`,
        args: [],
        env: {
          SLACK_BOT_TOKEN: token,
          ...(secret.team_id ? { SLACK_TEAM_ID: secret.team_id } : {}),
        },
      };
    case "linear":
      return {
        command: `${MCP_BIN}/mcp-linear`,
        args: [],
        env: { LINEAR_API_TOKEN: token },
      };
    case "gdrive":
      return {
        command: `${MCP_BIN}/google-drive-mcp`,
        args: [],
        env: { GOOGLE_DRIVE_MCP_ACCESS_TOKEN: token },
      };
    case "mcp":
      if (!secret.command) throw new Error(`${name} has no command`);
      return {
        command: secret.command,
        args: argsOf(secret.args),
        env: envOf(secret.env),
      };
    default:
      throw new Error(`${type} connections aren't MCP servers`);
  }
}

export type PrepareDeps = {
  /** Runs git with these extra variables; rejects when it fails. */
  git: (args: string[], env: Record<string, string>) => Promise<void>;
  log: (line: string) => void;
};

const TEN_MINUTES = 10 * 60_000;

/** Real git, its output dropped: a clone's output can name a URL, never a token. */
export const runGit: PrepareDeps["git"] = (args, env) =>
  new Promise((resolve, reject) => {
    execFile(
      "git",
      args,
      { env: { ...process.env, ...env }, timeout: TEN_MINUTES },
      (e) => (e ? reject(e) : resolve()),
    );
  });

/**
 * Writes the AWS config (removing a stale one) and clones each listed repo
 * not yet in the workspace. A failed clone is logged; the run goes on.
 */
export async function prepareWorkspace(
  w: Wiring,
  workspace: string,
  deps: PrepareDeps,
): Promise<void> {
  const awsDir = join(workspace, ".aws");
  if (w.awsConfig) {
    mkdirSync(awsDir, { recursive: true });
    writeFileSync(join(awsDir, "config"), w.awsConfig);
  } else {
    rmSync(join(awsDir, "config"), { force: true });
  }

  for (const repo of w.clone) {
    const dir = join(workspace, repo.split("/")[1] as string);
    if (existsSync(dir)) continue;
    try {
      await deps.git(
        ["clone", "--", `https://github.com/${repo}.git`, dir],
        w.env,
      );
    } catch {
      deps.log(`clone ${repo} failed`);
    }
  }
}
