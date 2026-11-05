import { createInterface } from "node:readline";
import { Writable } from "node:stream";
import { pathToFileURL } from "node:url";
import { createApi } from "./api";
import { loadCliConfig } from "./config";
import { openStore } from "./store";

export type Prompt = (
  question: string,
  opts?: { secret?: boolean },
) => Promise<string>;

export type CliDeps = {
  env: Record<string, string | undefined>;
  prompt: Prompt;
  registerConnection: (input: {
    name: string;
    type: string;
    scopeSummary: string;
  }) => Promise<{ id: string }>;
  out: (line: string) => void;
};

/** What each connection type needs, asked in this order. */
const FIELDS: Record<string, string[]> = {
  github: ["token"],
  aws: ["role_arn", "access_key_id", "secret_access_key"],
  slack: ["token"],
  linear: ["token"],
  gdrive: ["token"],
  mcp: ["command", "args", "env"],
};
/** Fields that are not secret, so are typed with echo. */
const PLAIN = new Set(["role_arn", "command", "args"]);

async function collectSecret(
  type: string,
  prompt: Prompt,
): Promise<Record<string, string>> {
  if (type === "env") {
    const secret: Record<string, string> = {};
    for (;;) {
      const line = (
        await prompt("KEY=VALUE (empty line to finish)", { secret: true })
      ).trim();
      if (!line) return secret;
      const eq = line.indexOf("=");
      if (eq < 1) throw new Error("Expected KEY=VALUE");
      secret[line.slice(0, eq)] = line.slice(eq + 1);
    }
  }
  const secret: Record<string, string> = {};
  for (const field of FIELDS[type]) {
    const value = await prompt(field, { secret: !PLAIN.has(field) });
    if (field === "env") JSON.parse(value || "{}"); // fail early on bad JSON
    secret[field] = value;
  }
  return secret;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<void> {
  const [group, action, ...rest] = argv;
  if (group !== "connection") throw new Error(USAGE);
  const config = loadCliConfig(deps.env);
  const store = openStore(config.dataDir, config.secretsKey);
  try {
    if (action === "add") {
      const [type, name] = rest;
      if (!name || !(type === "env" || type in FIELDS)) throw new Error(USAGE);
      const secret = await collectSecret(type, deps.prompt);
      const scopeSummary = await deps.prompt(
        "Scope summary (shown to the agent)",
      );
      const { id } = await deps.registerConnection({
        name,
        type,
        scopeSummary,
      });
      store.addConnection({ id, name, type, scopeSummary, secret });
      deps.out(`Added ${type} connection "${name}".`);
    } else if (action === "list") {
      for (const c of store.listConnections())
        deps.out(`${c.name}\t${c.type}\t${c.scopeSummary}`);
    } else if (action === "remove") {
      const [name] = rest;
      if (!name) throw new Error(USAGE);
      if (!store.removeConnection(name))
        throw new Error(`No local connection named "${name}"`);
      deps.out(
        `Removed the local secret for "${name}". Disable the connection in Settings too.`,
      );
    } else throw new Error(USAGE);
  } finally {
    store.close();
  }
}

const USAGE = `Usage:
  connection add <github|aws|slack|linear|gdrive|mcp|env> "<name>"
  connection list
  connection remove "<name>"`;

/** Reads a line from the terminal, hiding what is typed when `secret`. */
export const ttyPrompt: Prompt = (question, opts) =>
  new Promise((resolve) => {
    let muted = false;
    const output = new Writable({
      write(chunk, _enc, cb) {
        if (!muted) process.stdout.write(chunk);
        cb();
      },
    });
    const rl = createInterface({
      input: process.stdin,
      output,
      terminal: true,
    });
    process.stdout.write(`${question}: `);
    muted = !!opts?.secret;
    rl.question("", (answer) => {
      rl.close();
      if (muted) process.stdout.write("\n");
      resolve(answer);
    });
  });

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const config = loadCliConfig(process.env);
  const api = createApi(config);
  runCli(process.argv.slice(2), {
    env: process.env,
    prompt: ttyPrompt,
    registerConnection: async (input) => {
      const { result } = await api.worker.agent.registerConnection.mutate(
        input as Parameters<
          typeof api.worker.agent.registerConnection.mutate
        >[0],
      );
      return result;
    },
    out: console.log,
  }).catch((e: unknown) => {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  });
}
