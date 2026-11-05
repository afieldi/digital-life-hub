import { join } from "node:path";

/** One run's container. `env` holds only non-secret values (see `runEnv`). */
export type RunSpec = {
  runId: string;
  image: string;
  env: Record<string, string>;
};

/** Docker as the worker drives it; `cliDocker` runs the CLI, tests use a fake. */
export interface Docker {
  /** Starts the run's container detached. */
  run(spec: RunSpec): Promise<{ containerId: string }>;
  stop(name: string): Promise<void>;
  /** Removes a container, running or not; its volume stays. */
  remove(name: string): Promise<void>;
  /** Resolves when the container exits. */
  wait(name: string): Promise<{ exitCode: number }>;
  /** Names of every run container, running or not. */
  listRunContainers(): Promise<string[]>;
  removeVolume(name: string): Promise<void>;
  /** The image's `sha256:` id, which the run records. */
  imageDigest(image: string): Promise<string>;
}

export const containerName = (runId: string) => `dlh-run-${runId}`;
export const volumeName = (runId: string) => `dlh-ws-${runId}`;
/** The host directory mounted at `/run/dlh`, holding the run's socket. */
export const runDir = (dataDir: string, runId: string) =>
  join(dataDir, "runs", runId);
export const SOCKET_FILE = "dlh.sock";

/**
 * The container's environment. No secret: the model key is the placeholder
 * `dlh-run`, which the relay swaps for the Gateway key, and `ANTHROPIC_API_KEY`
 * must be empty or it would override that token.
 */
export function runEnv(runId: string): Record<string, string> {
  return {
    RUN_ID: runId,
    CLAUDE_CONFIG_DIR: "/workspace/.claude",
    ANTHROPIC_API_KEY: "",
    ANTHROPIC_AUTH_TOKEN: "dlh-run",
    ANTHROPIC_BASE_URL: "http://127.0.0.1:8788/model",
    CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
  };
}
