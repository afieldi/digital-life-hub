import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

export type DevStep = { name: string; run: () => Promise<void> };

export const NODE_MODULES_MESSAGE = 'Run "pnpm install" first.';
export const CARGO_MISSING_MESSAGE =
  'Rust is not installed — install it with rustup (https://rustup.rs) or run "pnpm --filter @dlh/desktop dev:web" for the browser-only shell.';

export type PreflightChecks = {
  hasNodeModules: () => boolean;
  hasCargo: () => boolean;
};
export type PreflightResult = { ok: true } | { ok: false; message: string };

export function preflight(checks: PreflightChecks): PreflightResult {
  if (!checks.hasNodeModules())
    return { ok: false, message: NODE_MODULES_MESSAGE };
  if (!checks.hasCargo()) return { ok: false, message: CARGO_MISSING_MESSAGE };
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

function runCommand(command: string, args: string[]): Promise<void> {
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
      if (code === 0 || signal === "SIGINT") resolve();
      else reject(new Error(`${command} exited with ${code ?? signal}`));
    });
  });
}

export const steps: DevStep[] = [
  {
    name: "desktop",
    run: () =>
      runCommand("pnpm", [
        "exec",
        "turbo",
        "run",
        "dev",
        "--filter=@dlh/desktop",
      ]),
  },
];

async function main(): Promise<void> {
  const result = preflight({
    hasNodeModules: () => existsSync("node_modules"),
    hasCargo: () => onPath("cargo"),
  });
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }
  for (const step of steps) {
    console.log(`> ${step.name}`);
    await step.run();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
