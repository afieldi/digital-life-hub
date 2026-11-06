import { execFileSync, spawn } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = join(import.meta.dirname, "..", "bin");
const has = (cmd: string) => {
  try {
    execFileSync("sh", ["-c", `command -v ${cmd}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

const SECRETS: Record<string, Record<string, string>> = {
  "/credentials/github/GitHub%20work": { token: "ghp_test_token" },
  "/credentials/aws/Prod%20AWS": {
    Version: "1",
    AccessKeyId: "ASIA_TEMP",
    SecretAccessKey: "temp-secret",
    SessionToken: "temp-session",
    Expiration: "2026-11-05T11:00:00.000Z",
  },
};

let dir: string;
let socket: string;
let server: Server;

beforeAll(async () => {
  // Unix socket paths are short (104 bytes on macOS); /tmp keeps them under it.
  dir = mkdtempSync(
    join(process.platform === "darwin" ? "/tmp" : tmpdir(), "dlh-bin-"),
  );
  socket = join(dir, "dlh.sock");
  server = createServer((req, res) => {
    const secret = SECRETS[req.url ?? ""];
    res.writeHead(secret ? 200 : 403, { "content-type": "application/json" });
    res.end(JSON.stringify(secret ? { secret } : { error: "Not granted: x." }));
  });
  await new Promise<void>((r) => server.listen(socket, r));
  // A stand-in for the real gh: prints whether it got a token.
  writeFileSync(
    join(dir, "real-gh"),
    // biome-ignore lint/suspicious/noTemplateCurlyInString: shell, not JS
    '#!/bin/sh\necho "token=${GH_TOKEN:-none} args=$*"\n',
  );
  chmodSync(join(dir, "real-gh"), 0o755);
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

/** Runs a script (async: the stub socket is served by this process). */
const run = (
  script: string,
  args: string[],
  input: string,
  env: Record<string, string>,
) =>
  new Promise<{ status: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn("sh", [join(BIN, script), ...args], {
        env: { PATH: process.env.PATH ?? "", DLH_SOCKET: socket, ...env },
      });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (c) => {
        stdout += c;
      });
      child.stderr.on("data", (c) => {
        stderr += c;
      });
      child.on("error", reject);
      child.on("close", (status) => resolve({ status, stdout, stderr }));
      child.stdin.end(input);
    },
  );

// POSIX shell scripts talking to a Unix socket: they run in the Linux image.
describe.skipIf(process.platform === "win32" || !has("jq") || !has("curl"))(
  "bin scripts",
  () => {
    it("dlh-credential git answers get for github.com only", async () => {
      const env = { DLH_GITHUB_CONNECTION: "GitHub work" };
      const get = await run(
        "dlh-credential",
        ["git", "get"],
        "protocol=https\nhost=github.com\n\n",
        env,
      );
      expect(get.status).toBe(0);
      expect(get.stdout).toBe(
        "username=x-access-token\npassword=ghp_test_token\n",
      );

      const other = await run(
        "dlh-credential",
        ["git", "get"],
        "protocol=https\nhost=gitlab.com\n\n",
        env,
      );
      expect(other.stdout).toBe("");
      const store = await run(
        "dlh-credential",
        ["git", "store"],
        "protocol=https\nhost=github.com\npassword=x\n\n",
        env,
      );
      expect(store.status).toBe(0);
      expect(store.stdout).toBe("");
      const none = await run(
        "dlh-credential",
        ["git", "get"],
        "protocol=https\nhost=github.com\n\n",
        {},
      );
      expect(none.stdout).toBe("");
    });

    it("dlh-credential aws prints credential_process JSON, and a refusal on stderr", async () => {
      const ok = await run("dlh-credential", ["aws", "Prod AWS"], "", {});
      expect(ok.status).toBe(0);
      expect(JSON.parse(ok.stdout)).toEqual({
        Version: 1,
        AccessKeyId: "ASIA_TEMP",
        SecretAccessKey: "temp-secret",
        SessionToken: "temp-session",
        Expiration: "2026-11-05T11:00:00.000Z",
      });
      const refused = await run("dlh-credential", ["aws", "Other"], "", {});
      expect(refused.status).toBe(1);
      expect(refused.stdout).toBe("");
      expect(refused.stderr).toContain("Not granted: x.");
    });

    it("gh runs the real gh with GH_TOKEN in its environment only", async () => {
      const real = join(dir, "real-gh");
      const r = await run("gh", ["pr", "list"], "", {
        DLH_GITHUB_CONNECTION: "GitHub work",
        DLH_REAL_GH: real,
      });
      expect(r.stdout).toBe("token=ghp_test_token args=pr list\n");
      const without = await run("gh", ["--version"], "", { DLH_REAL_GH: real });
      expect(without.stdout).toBe("token=none args=--version\n");
      expect(without.stderr).toContain("request_connection");
    });
  },
);
