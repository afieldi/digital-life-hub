import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

export type StepResult = "done" | "interrupted";
export type DevStep = { name: string; run: () => Promise<StepResult> };

export const NODE_MODULES_MESSAGE = 'Run "pnpm install" first.';
export const CARGO_MISSING_MESSAGE =
  'Rust is not installed — install it with rustup (https://rustup.rs) or run "pnpm --filter @dlh/desktop dev:web" for the browser-only shell.';

export const DOCKER_MISSING_MESSAGE =
  "Docker is not installed — install Docker Desktop (https://www.docker.com/products/docker-desktop/).";
export const DOCKER_DOWN_MESSAGE =
  "Docker isn't running — start Docker Desktop, then run pnpm dev again.";
export const API_ENV_MESSAGE =
  "Copy apps/api/.env.example to apps/api/.env and fill in the Google client and ALLOWED_EMAIL.";

export type PreflightChecks = {
  hasNodeModules: () => boolean;
  hasCargo: () => boolean;
  hasDocker: () => boolean;
  dockerRunning: () => boolean;
  hasApiEnv: () => boolean;
};
export type PreflightResult = { ok: true } | { ok: false; message: string };

export function preflight(checks: PreflightChecks): PreflightResult {
  if (!checks.hasNodeModules())
    return { ok: false, message: NODE_MODULES_MESSAGE };
  if (!checks.hasCargo()) return { ok: false, message: CARGO_MISSING_MESSAGE };
  if (!checks.hasDocker())
    return { ok: false, message: DOCKER_MISSING_MESSAGE };
  if (!checks.dockerRunning())
    return { ok: false, message: DOCKER_DOWN_MESSAGE };
  if (!checks.hasApiEnv()) return { ok: false, message: API_ENV_MESSAGE };
  return { ok: true };
}

function onPath(binary: string): boolean {
  const exts =
    process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  return (process.env.PATH ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((dir) => exts.some((e) => existsSync(join(dir, binary + e))));
}

function runCommand(command: string, args: string[]): Promise<StepResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      stdio: "inherit",
      shell: process.platform === "win32",
    });
    const forward = () => child.kill("SIGINT");
    process.on("SIGINT", forward);
    child.on("error", reject);
    child.on("close", (code, signal) => {
      process.off("SIGINT", forward);
      if (signal === "SIGINT") resolve("interrupted");
      else if (code === 0) resolve("done");
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

// Ctrl+C stops the last step only: Postgres keeps running (pnpm dev:down stops it).
export const steps: DevStep[] = [
  {
    name: "db",
    run: () => runCommand("docker", ["compose", "up", "-d", "--wait"]),
  },
  {
    name: "migrate",
    run: () =>
      runCommand("pnpm", [
        "--filter",
        "@dlh/db",
        "exec",
        "tsx",
        // Same DATABASE_URL source as the API (apps/api/.env, else the default).
        "--env-file-if-exists=../../apps/api/.env",
        "src/cli/migrate.ts",
      ]),
  },
  {
    name: "seed",
    // Sample data from every module's seed, only while `items` is empty.
    run: () => runCommand("pnpm", ["--filter", "@dlh/api", "seed"]),
  },
  {
    name: "apps",
    run: () =>
      runCommand("pnpm", [
        "exec",
        "turbo",
        "run",
        "dev",
        "--filter=@dlh/api",
        "--filter=@dlh/desktop",
        "--ui=stream",
      ]),
  },
];

/** Runs steps in order. Returns the exit code: 130 when Ctrl+C stopped a step
 * before the last one, 0 when it ended the last step, 1 when a step failed. */
export async function runSteps(
  list: DevStep[],
  log: (message: string) => void,
  error: (message: string) => void,
): Promise<number> {
  for (const [i, step] of list.entries()) {
    log(`> ${step.name}`);
    try {
      const result = await step.run();
      if (result === "interrupted") return i === list.length - 1 ? 0 : 130;
    } catch (err) {
      error(err instanceof Error ? err.message : String(err));
      return 1;
    }
  }
  return 0;
}

async function main(): Promise<void> {
  const result = preflight({
    hasNodeModules: () => existsSync("node_modules"),
    hasCargo: () => onPath("cargo"),
    hasDocker: () => onPath("docker"),
    dockerRunning: () =>
      spawnSync("docker", ["info"], {
        stdio: "ignore",
        shell: process.platform === "win32",
      }).status === 0,
    hasApiEnv: () => existsSync(join("apps", "api", ".env")),
  });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  process.exit(await runSteps(steps, console.log, console.error));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main();
