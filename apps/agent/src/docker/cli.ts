import { execFile as nodeExecFile } from "node:child_process";
import { promisify } from "node:util";
import { containerName, type Docker, runDir, volumeName } from "./docker";

/** `child_process.execFile`, promisified: rejects with `stderr` on a non-zero exit. */
export type ExecFile = (
  file: string,
  args: string[],
) => Promise<{ stdout: string; stderr: string }>;

export const execFile: ExecFile = promisify(nodeExecFile);

/** The isolation every run container gets; nothing here is per run but the names. */
const ISOLATION = [
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
  "dlh-runs",
  // Public resolvers: the host's upstream may sit in a range the firewall blocks.
  "--dns",
  "1.1.1.1",
  "--dns",
  "9.9.9.9",
];

/** Docker through its CLI. A failed command throws docker's own stderr. */
export function cliDocker(exec: ExecFile, opts: { dataDir: string }): Docker {
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
    async run({ runId, image, env }) {
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
        `${runDir(opts.dataDir, runId)}:/run/dlh`,
        ...Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]),
        image,
      );
      return { containerId };
    },
    async stop(name) {
      await docker("stop", name);
    },
    async remove(name) {
      await docker("rm", "-f", name);
    },
    async wait(name) {
      return { exitCode: Number(await docker("wait", name)) };
    },
    async listRunContainers() {
      const out = await docker(
        "ps",
        "-a",
        "--filter",
        "label=dlh.run",
        "--format",
        "{{.Names}}",
      );
      return out.split("\n").filter(Boolean);
    },
    async removeVolume(name) {
      await docker("volume", "rm", name);
    },
    async imageDigest(image) {
      return docker("image", "inspect", "--format", "{{.Id}}", image);
    },
  };
}
