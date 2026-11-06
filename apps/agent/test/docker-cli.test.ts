import { describe, expect, it } from "vitest";
import { cliDocker, type ExecFile } from "../src/docker/cli";
import { runEnv } from "../src/docker/docker";

const RUN = "5b0c6a8e-1d2f-4e3a-9b7c-0123456789ab";

/** Records each docker call and answers with `stdout`, or fails with `stderr`. */
function fakeExec(answer: { stdout?: string; stderr?: string; fail?: true }) {
  const calls: string[][] = [];
  const exec: ExecFile = async (file, args) => {
    calls.push([file, ...args]);
    if (answer.fail) {
      throw Object.assign(new Error("Command failed: docker run …"), {
        stderr: answer.stderr ?? "",
      });
    }
    return { stdout: answer.stdout ?? "", stderr: "" };
  };
  return { exec, calls };
}

describe("cliDocker", () => {
  it("run uses exactly the isolation flags and no secret", async () => {
    const { exec, calls } = fakeExec({ stdout: "abc123\n" });
    const docker = cliDocker(exec, { dataDir: "/var/lib/dlh-agent" });
    const env = runEnv(RUN);

    const out = await docker.run({
      runId: RUN,
      image: "dlh-agent-runner",
      env,
    });

    expect(out).toEqual({ containerId: "abc123" });
    expect(calls).toEqual([
      [
        "docker",
        "run",
        "-d",
        "--name",
        `dlh-run-${RUN}`,
        "--label",
        `dlh.run=${RUN}`,
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
        "dlh-runs",
        "--dns",
        "1.1.1.1",
        "--dns",
        "9.9.9.9",
        "-v",
        `dlh-ws-${RUN}:/workspace`,
        "-v",
        `/var/lib/dlh-agent/runs/${RUN}:/run/dlh`,
        "-e",
        `RUN_ID=${RUN}`,
        "-e",
        "CLAUDE_CONFIG_DIR=/workspace/.claude",
        "-e",
        "ANTHROPIC_API_KEY=",
        "-e",
        "ANTHROPIC_AUTH_TOKEN=dlh-run",
        "-e",
        "ANTHROPIC_BASE_URL=http://127.0.0.1:8788/model",
        "-e",
        "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1",
        "dlh-agent-runner",
      ],
    ]);
    const argv = calls[0]?.join(" ") ?? "";
    expect(argv).not.toMatch(
      /privileged|docker\.sock|AI_GATEWAY|TOKEN=(?!dlh-run)/,
    );
  });

  it("a failed command throws docker's own message", async () => {
    const { exec } = fakeExec({
      fail: true,
      stderr: "Unable to find image 'nope:latest' locally\nmore detail\n",
    });
    const docker = cliDocker(exec, { dataDir: "/d" });
    await expect(
      docker.run({ runId: RUN, image: "nope", env: {} }),
    ).rejects.toThrow(
      "Unable to find image 'nope:latest' locally\nmore detail",
    );
  });

  it("wait reads the exit code", async () => {
    const { exec, calls } = fakeExec({ stdout: "137\n" });
    const docker = cliDocker(exec, { dataDir: "/d" });
    expect(await docker.wait(`dlh-run-${RUN}`)).toEqual({ exitCode: 137 });
    expect(calls[0]).toEqual(["docker", "wait", `dlh-run-${RUN}`]);
  });

  it("lists run containers by their label", async () => {
    const { exec, calls } = fakeExec({ stdout: "dlh-run-a\ndlh-run-b\n" });
    const docker = cliDocker(exec, { dataDir: "/d" });
    expect(await docker.listRunContainers()).toEqual([
      "dlh-run-a",
      "dlh-run-b",
    ]);
    expect(calls[0]).toEqual([
      "docker",
      "ps",
      "-a",
      "--filter",
      "label=dlh.run",
      "--format",
      "{{.Names}}",
    ]);
  });

  it("reads an image's digest", async () => {
    const id = `sha256:${"a".repeat(64)}`;
    const { exec, calls } = fakeExec({ stdout: `${id}\n` });
    const docker = cliDocker(exec, { dataDir: "/d" });
    expect(await docker.imageDigest("dlh-agent-runner")).toBe(id);
    expect(calls[0]).toEqual([
      "docker",
      "image",
      "inspect",
      "--format",
      "{{.Id}}",
      "dlh-agent-runner",
    ]);
  });

  it("stops, removes and removes volumes by name", async () => {
    const { exec, calls } = fakeExec({});
    const docker = cliDocker(exec, { dataDir: "/d" });
    await docker.stop("dlh-run-a");
    await docker.remove("dlh-run-a");
    await docker.removeVolume("dlh-ws-a");
    expect(calls).toEqual([
      ["docker", "stop", "dlh-run-a"],
      ["docker", "rm", "-f", "dlh-run-a"],
      ["docker", "volume", "rm", "dlh-ws-a"],
    ]);
  });
});
