import { posix } from "node:path";

/** One run's container. `env` holds only non-secret values (see `runEnv`). */
export type RunSpec = {
  runId: string;
  image: string;
  env: Record<string, string>;
  /** The host directory mounted at `/run/dlh`: this start's own (see `runDir`). */
  socketDir: string;
};

/** Docker as the worker drives it; `cliDocker` runs the CLI, tests use a fake. */
export interface Docker {
  /**
   * Starts the run's container detached, named `containerName(runId)`. The
   * supervisor then acts on it by the id this returns: a later start of the
   * same run takes the name.
   */
  run(spec: RunSpec): Promise<{ containerId: string }>;
  stop(container: string): Promise<void>;
  /** Removes a container, running or not; its volume stays. */
  remove(container: string): Promise<void>;
  /** Resolves when the container exits. */
  wait(container: string): Promise<{ exitCode: number }>;
  /** Ids of every run container, or of one run's, running or not. */
  listRunContainers(runId?: string): Promise<string[]>;
  removeVolume(name: string): Promise<void>;
  /** The image's `sha256:` id, which the run records. */
  imageDigest(image: string): Promise<string>;
  /**
   * Whether `dlh-runs` is as `deploy/vps/runs-firewall.sh` makes it: no
   * traffic between runs (`enable_icc=false`), no IPv6, and the bridge named
   * `dlh-runs0`, which the firewall's rules name. False if it's missing.
   */
  networkIsolated(): Promise<boolean>;
}

/** The run containers' network, and its bridge's fixed name. */
export const RUN_NETWORK = "dlh-runs";
export const RUN_BRIDGE = "dlh-runs0";

export const containerName = (runId: string) => `dlh-run-${runId}`;
export const volumeName = (runId: string) => `dlh-ws-${runId}`;
/**
 * The run's host directory. Each start of the run makes its own directory in
 * it for the socket and mounts that at `/run/dlh`, so a supervisor that ends
 * late (closing its server unlinks its socket's path) can't touch its
 * successor's socket.
 * The worker runs on a Linux host, so the path is POSIX on every platform.
 */
export const runDir = (dataDir: string, runId: string) =>
  posix.join(dataDir, "runs", runId);
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
