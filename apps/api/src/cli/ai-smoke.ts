import { spawn, spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createDb, databaseUrlFrom, items } from "@dlh/db";
import {
  type AiProvider,
  CORE_ROUTER_IDS,
  type CoreDeps,
  collectServerModules,
  complete,
  coreAi,
  createChangeBus,
  createOpenRouter,
  listLog,
  prepare,
  undo,
  writeItems,
} from "@dlh/server";
import { eq } from "drizzle-orm";
import { serverModules } from "../modules.gen";

type PrepareInput = Parameters<typeof prepare>[1];
type AiResult = Awaited<ReturnType<typeof prepare>>;
type AiProviderId = NonNullable<PrepareInput["provider"]>;

const TIMEOUT_MS = 120_000;
const ITEM_TITLE = "AI smoke test item";
const ITEM_TEXT =
  "The quarterly report covers revenue, hiring and the new office. " +
  "Revenue grew eight percent. Two engineers joined in March. " +
  "The office move is planned for June.";

type CliRun = { system: string; prompt: string; schema: unknown };

/**
 * Claude CLI arguments (Ruling P4). A later task verifies the flags against the
 * installed CLI.
 */
export function claudeArgs(run: CliRun): string[] {
  return [
    "-p",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(run.schema),
    "--system-prompt",
    run.system,
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--disable-slash-commands",
  ];
}

/** Codex CLI arguments (Ruling P4); `dir` holds schema.json and out.txt. */
export function codexArgs(dir: string): string[] {
  return [
    "exec",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--output-schema",
    join(dir, "schema.json"),
    "--output-last-message",
    join(dir, "out.txt"),
    "-",
  ];
}

function onPath(bin: string): boolean {
  const r = spawnSync(process.platform === "win32" ? "where" : "which", [bin], {
    stdio: "ignore",
  });
  return r.status === 0;
}

function spawnCli(
  bin: string,
  args: string[],
  stdin: string,
  cwd: string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: TIMEOUT_MS,
    });
    let out = "";
    let err = "";
    child.stdout.on("data", (d) => {
      out += d;
    });
    child.stderr.on("data", (d) => {
      err += d;
    });
    child.on("error", reject);
    child.on("close", (code, signal) =>
      code === 0
        ? resolve(out)
        : reject(
            new Error(`${bin} exited ${code ?? signal}: ${err.slice(0, 500)}`),
          ),
    );
    child.stdin.end(stdin);
  });
}

/** Runs a CLI request the way the app would and returns what `complete` needs. */
async function runCli(
  provider: "claude-cli" | "codex-cli",
  run: CliRun,
): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "dlh-ai-smoke-"));
  try {
    if (provider === "claude-cli") {
      return await spawnCli("claude", claudeArgs(run), run.prompt, dir);
    }
    await writeFile(join(dir, "schema.json"), JSON.stringify(run.schema));
    await spawnCli(
      "codex",
      codexArgs(dir),
      `${run.system}\n\n${run.prompt}`,
      dir,
    );
    return await readFile(join(dir, "out.txt"), "utf8");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

type Target = { id: AiProviderId; label: string; skip: string | null };

function targets(): Target[] {
  return [
    {
      id: "openrouter",
      label: "OpenRouter",
      skip: process.env.OPENROUTER_API_KEY
        ? null
        : "OPENROUTER_API_KEY not set",
    },
    {
      id: "claude-cli",
      label: "Claude",
      skip: onPath("claude") ? null : "`claude` not found on PATH",
    },
    {
      id: "codex-cli",
      label: "Codex",
      skip: onPath("codex") ? null : "`codex` not found on PATH",
    },
  ];
}

async function call(
  deps: CoreDeps,
  provider: AiProviderId,
  input: { text: string; itemId: string; actionId: string; kind: "ask" | "do" },
): Promise<AiResult> {
  const first = await prepare(deps, { ...input, provider });
  if (first.status !== "run") return first;
  const raw = await runCli(
    first.run.provider as "claude-cli" | "codex-cli",
    first.run,
  );
  return complete(deps, { requestId: first.requestId, raw });
}

async function printLog(deps: CoreDeps, requestId: string): Promise<void> {
  const { entries } = await listLog(deps.db, {});
  const row = entries.find((e) => e.id === requestId);
  console.log("  log:", row ? JSON.stringify(row) : "(row not found)");
}

async function smoke(deps: CoreDeps, t: Target, itemId: string) {
  console.log(`\n${t.label}`);
  const answer = await call(deps, t.id, {
    text: "summarise this item",
    itemId,
    actionId: "answer",
    kind: "ask",
  });
  console.log("  answer:", JSON.stringify(answer));
  await printLog(deps, answer.requestId);

  const retitle = await call(deps, t.id, {
    text: "give this a better title",
    itemId,
    actionId: "retitle",
    kind: "do",
  });
  console.log("  retitle:", JSON.stringify(retitle));
  await printLog(deps, retitle.requestId);
  if (retitle.status === "applied") {
    console.log("  undo:", JSON.stringify(await undo(deps, retitle)));
    await printLog(deps, retitle.requestId);
  }
}

/** Soft-deletes the smoke item at its current version (retitle moved it). */
async function softDelete(deps: CoreDeps, id: string): Promise<void> {
  const [row] = await deps.db.select().from(items).where(eq(items.id, id));
  if (!row) return;
  await writeItems(deps, (w) =>
    w.setDeleted({
      id,
      expectedUpdatedAt: row.updatedAt.toISOString(),
      deleted: true,
    }),
  );
  console.log("\nSmoke item soft-deleted.");
}

async function main(): Promise<void> {
  const { db, close } = createDb(databaseUrlFrom(process.env));
  const { itemTypes, aiRunners } = collectServerModules(
    [...serverModules],
    [...CORE_ROUTER_IDS],
    coreAi,
  );
  const providers: Partial<Record<"openrouter", AiProvider>> = process.env
    .OPENROUTER_API_KEY
    ? {
        openrouter: createOpenRouter({
          apiKey: process.env.OPENROUTER_API_KEY,
        }),
      }
    : {};
  const deps: CoreDeps = {
    db,
    changes: createChangeBus(),
    itemTypes,
    now: () => new Date(),
    devErrors: false,
    ai: {
      runners: aiRunners,
      descriptions: [...aiRunners.values()].map((r) => r.action),
      providers,
      defaultModel: process.env.OPENROUTER_DEFAULT_MODEL ?? null,
    },
  };
  let itemId: string | null = null;
  try {
    for (const t of targets()) {
      if (t.skip) console.log(`${t.label}: skipped — ${t.skip}`);
    }
    const active = targets().filter((t) => !t.skip);
    if (active.length === 0) return;
    const item = await writeItems(deps, (w) =>
      w.createItem({
        type: "sample",
        title: ITEM_TITLE,
        searchText: ITEM_TEXT,
      }),
    );
    itemId = item.id;
    for (const t of active) {
      try {
        await smoke(deps, t, item.id);
      } catch (e) {
        console.log(`  failed: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  } finally {
    if (itemId) await softDelete(deps, itemId);
    await close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
