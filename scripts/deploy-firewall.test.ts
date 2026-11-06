import { execFile } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPT = join(root, "deploy/vps/runs-firewall.sh");
const run = promisify(execFile);

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Runs the script with stand-ins for iptables and docker on PATH: iptables
 * logs each call and has no rule yet; docker logs each call, and `network
 * inspect` prints `inspect` (or fails when it's null: no network).
 */
async function firewall(args: string[], inspect: string | null) {
  const bin = mkdtempSync(join(tmpdir(), "dlh-fw-"));
  dirs.push(bin);
  const log = join(bin, "calls.log");
  const stub = (name: string, body: string) => {
    writeFileSync(
      join(bin, name),
      `#!/bin/sh\necho "${name} $*" >> "${log}"\n${body}\n`,
    );
    chmodSync(join(bin, name), 0o755);
  };
  stub("iptables", 'case "$1" in -C) exit 1;; esac; exit 0');
  stub(
    "docker",
    inspect === null
      ? 'case "$*" in "network inspect"*) exit 1;; esac; exit 0'
      : `case "$*" in "network inspect"*"--format"*) echo '${inspect}';; esac; exit 0`,
  );
  const env = { ...process.env, PATH: `${bin}:/usr/bin:/bin` };
  const out = await run("sh", [SCRIPT, ...args], { env }).then(
    (r) => ({ code: 0, stderr: r.stderr }),
    (e: { code: number; stderr: string }) => ({
      code: e.code,
      stderr: e.stderr,
    }),
  );
  const calls = readFileSync(log, "utf8").trim().split("\n");
  return { ...out, calls };
}

describe("runs-firewall.sh", () => {
  it("--rules-only names the bridge and needs no Docker", async () => {
    const { code, calls } = await firewall(["--rules-only"], null);
    expect(code).toBe(0);
    expect(calls.some((c) => c.startsWith("docker"))).toBe(false);
    expect(calls).toContain("iptables -N DOCKER-USER");
    const inserted = calls.filter((c) => / -I /.test(` ${c}`));
    expect(inserted).toContain(
      "iptables -I DOCKER-USER 1 -i dlh-runs0 -d 169.254.0.0/16 -j DROP",
    );
    expect(inserted).toContain("iptables -I INPUT 1 -i dlh-runs0 -j DROP");
    // Keyed on the interface, never a subnet only Docker knows.
    expect(inserted.every((c) => c.includes("-i dlh-runs0"))).toBe(true);
  });

  it("makes a missing network with the fixed bridge, no ICC and no IPv6", async () => {
    const { calls } = await firewall([], null);
    expect(calls).toContain(
      "docker network create --driver bridge --opt com.docker.network.bridge.name=dlh-runs0 --opt com.docker.network.bridge.enable_icc=false --ipv6=false dlh-runs",
    );
  });

  it("accepts a network made as it makes one", async () => {
    const { code } = await firewall([], "false dlh-runs0 false");
    expect(code).toBe(0);
  });

  it("refuses a network made another way", async () => {
    for (const inspect of [
      "true dlh-runs0 false",
      " br-1234 false",
      "false dlh-runs0 true",
    ]) {
      const { code, stderr } = await firewall([], inspect);
      expect(code, inspect).not.toBe(0);
      expect(stderr).toContain("docker network rm dlh-runs");
    }
  });

  it("the systemd unit installs the rules before Docker starts", () => {
    const unit = readFileSync(
      join(root, "deploy/vps/dlh-runs-firewall.service"),
      "utf8",
    );
    expect(unit).toMatch(/^Before=docker\.service$/m);
    expect(unit).toMatch(/^Type=oneshot$/m);
    expect(unit).toMatch(/^ExecStart=.*dlh-runs-firewall --rules-only$/m);
    expect(unit).toMatch(/^WantedBy=.*multi-user\.target/m);
  });
});
