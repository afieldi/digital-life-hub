import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import {
  containerName,
  type Docker,
  RUN_BRIDGE,
  RUN_NETWORK,
  volumeName,
} from "./docker";

/** `child_process.execFile`, promisified: rejects with `stderr` on a non-zero exit. */
export type ExecFile = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export const execFile: ExecFile = promisify(nodeExecFile);

/** The isolation every run container gets; nothing here is per run but the names. */
const ISOLATION = [
  // An init as PID 1: the runner (node) has no SIGTERM handler, and PID 1
  // ignores a signal it doesn't handle, so `docker stop` would wait it out.
  "--init",
  "--user",
  "1000:1000",
  "--read-only",
  "--tmpfs",
  "/tmp",
  "--cpus",
  "2",
  "--memory",
  "4g",
  "--pids-limit",
  "512",
  "--cap-drop",
  "ALL",
  "--security-opt",
  "no-new-privileges",
  "--network",
  RUN_NETWORK,
  // Public resolvers: the host's upstream may sit in a range the firewall blocks.
  "--dns",
  "1.1.1.1",
  "--dns",
  "9.9.9.9",
];

/** Docker through its CLI. A failed command throws docker's own stderr. */
export function cliDocker(exec: ExecFile): Docker {
  const docker = async (...args: string[]) => {
    try {
      return (await exec("docker", args)).stdout.trim();
    } catch (e) {
      const stderr = (e as { stderr?: unknown }).stderr;
      throw new Error(
        typeof stderr === "string" && stderr.trim()
          ? stderr.trim()
          : (e as Error).message,
      );
    }
  };

  return {
    async run({ runId, image, env, socketDir }) {
      const containerId = await docker(
        "run",
        "-d",
        "--name",
        containerName(runId),
        "--label",
        `dlh.run=${runId}`,
        ...ISOLATION,
        "-v",
        `${volumeName(runId)}:/workspace`,
        "-v",
        `${socketDir}:/run/dlh`,
        ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
        image,
      );
      return { containerId };
    },
    async stop(container) {
      await docker("stop", container);
    },
    async remove(container) {
      await docker("rm", "-f", container);
    },
    async wait(container) {
      return { exitCode: Number(await docker("wait", container)) };
    },
    async listRunContainers(runId) {
      const out = await docker(
        "ps",
        "-a",
        "--filter",
        runId ? `label=dlh.run=${runId}` : "label=dlh.run",
        "--format",
        "{{.ID}}",
      );
      return out.split("\n").filter(Boolean);
    },
    async removeVolume(name) {
      await docker("volume", "rm", name);
    },
    async imageDigest(image) {
      return docker("image", "inspect", "--format", "{{.Id}}", image);
    },
    async networkIsolated() {
      try {
        const out = await docker(
          "network",
          "inspect",
          RUN_NETWORK,
          "--format",
          '{{index .Options "com.docker.network.bridge.enable_icc"}} {{index .Options "com.docker.network.bridge.name"}} {{.EnableIPv6}}',
        );
        return out === `false ${RUN_BRIDGE} false`;
      } catch {
        return false;
      }
    },
  };
}
