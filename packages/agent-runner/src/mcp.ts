import { spawn } from "node:child_process";
import { launchSpec, serverEnv } from "./connections";
import { createHost } from "./host";

/**
 * `node /opt/runner/mcp.js <type> <name>`: starts a connection's MCP server
 * with its secret, fetched from the socket now, in that process's environment
 * only, which holds nothing else of the run's (see `serverEnv`). The SDK
 * gives server configs to its child on the command line, so the config names
 * this launcher and holds no secret. stdio passes straight through.
 */
const [type, name] = process.argv.slice(2);
const log = (line: string) => console.error(`dlh-mcp: ${line}`);

async function main(): Promise<void> {
  if (!type || !name) throw new Error("usage: mcp.js <type> <name>");
  const host = createHost();
  const spec = await launchSpec(type, name, (t, n) => host.credentials(t, n));
  const child = spawn(spec.command, spec.args, {
    stdio: "inherit",
    env: serverEnv(process.env, spec.env),
  });
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => child.kill(signal));
  }
  child.on("error", (e) => {
    log(`${name}: ${e.message.split("\n")[0]}`);
    process.exit(1);
  });
  child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}

main().catch((e: unknown) => {
  log(
    `${name ?? "?"}: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`,
  );
  process.exit(1);
});
