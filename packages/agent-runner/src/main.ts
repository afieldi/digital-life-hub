import { query } from "@anthropic-ai/claude-agent-sdk";
import { startForwarder } from "./forwarder";
import { createHost } from "./host";
import { runSession } from "./session";

/**
 * The container's program: one Agent SDK session per start. It exits 0 once
 * the run is reported (finished, failed or suspended) and 1 when the worker
 * couldn't be told. Its output never carries a request body or tool input.
 */
const log = (line: string) => console.error(`runner: ${line}`);

async function main(): Promise<number> {
  const host = createHost();
  const forwarder = await startForwarder();
  try {
    const start = await host.run();
    const outcome = await runSession(start, {
      query,
      host,
      configDir: process.env.CLAUDE_CONFIG_DIR ?? "/workspace/.claude",
      workspace: "/workspace",
      log,
    });
    log(`session ended: ${outcome}`);
    return outcome === "host_error" ? 1 : 0;
  } finally {
    forwarder.close();
  }
}

main().then(
  (code) => process.exit(code),
  (e: unknown) => {
    log(
      `start: ${(e instanceof Error ? e.message : String(e)).split("\n")[0]}`,
    );
    process.exit(1);
  },
);
