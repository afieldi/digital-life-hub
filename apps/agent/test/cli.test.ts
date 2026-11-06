import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli";
import { loadCliConfig } from "../src/config";
import { openStore } from "../src/store";

const key = Buffer.alloc(32, 7).toString("base64");

function setup(answers: string[]) {
  const dataDir = mkdtempSync(join(tmpdir(), "dlh-cli-"));
  const env = {
    API_URL: "http://127.0.0.1:8787",
    AGENT_WORKER_TOKEN: "w",
    AGENT_SECRETS_KEY: key,
    AGENT_DATA_DIR: dataDir,
  };
  const asked: { q: string; secret: boolean }[] = [];
  const registered: unknown[] = [];
  const out: string[] = [];
  const deps = {
    env,
    prompt: async (q: string, o?: { secret?: boolean }) => {
      asked.push({ q, secret: !!o?.secret });
      return answers.shift() ?? "";
    },
    registerConnection: async (input: unknown) => {
      registered.push(input);
      return { id: "conn-1" };
    },
    out: (s: string) => out.push(s),
  };
  return { dataDir, deps, asked, registered, out };
}

describe("loadCliConfig", () => {
  it("does not need the Gateway key", () => {
    const c = loadCliConfig({
      API_URL: "http://127.0.0.1:8787",
      AGENT_WORKER_TOKEN: "w",
      AGENT_SECRETS_KEY: key,
    });
    expect(c.dataDir).toBe("/var/lib/dlh-agent");
    expect(c.secretsKey.length).toBe(32);
  });
});

describe("connection CLI", () => {
  it("connection add registers the metadata and keeps the secret local", async () => {
    const { dataDir, deps, asked, registered, out } = setup([
      "ghp_secret",
      "repo: read",
    ]);
    await runCli(["connection", "add", "github", "my gh"], deps);
    expect(registered).toEqual([
      { name: "my gh", type: "github", scopeSummary: "repo: read" },
    ]);
    expect(JSON.stringify(registered)).not.toContain("ghp_secret");
    expect(asked[0]).toMatchObject({ secret: true });
    expect(asked[1]).toMatchObject({ secret: false });
    expect(out.join("\n")).not.toContain("ghp_secret");
    const store = openStore(dataDir, Buffer.from(key, "base64"));
    expect(store.secretOf("conn-1")).toEqual({ token: "ghp_secret" });
  });

  it("connection add for env reads lines until a blank one", async () => {
    const { dataDir, deps, registered } = setup([
      "A=1",
      "B=two=2",
      "",
      "build env",
    ]);
    await runCli(["connection", "add", "env", "build"], deps);
    expect(registered).toEqual([
      { name: "build", type: "env", scopeSummary: "build env" },
    ]);
    const store = openStore(dataDir, Buffer.from(key, "base64"));
    expect(store.secretOf("conn-1")).toEqual({ A: "1", B: "two=2" });
  });

  it("connection add with an existing name refuses before registering", async () => {
    const s = setup(["tok", "T0001", "scope"]);
    await runCli(["connection", "add", "slack", "team"], s.deps);
    s.registered.length = 0;
    await expect(
      runCli(["connection", "add", "slack", "team"], s.deps),
    ).rejects.toThrow("already exists");
    expect(s.registered).toEqual([]);
  });

  it("list prints metadata and remove deletes the local secret", async () => {
    const s = setup(["tok", "T0001", "channels"]);
    await runCli(["connection", "add", "slack", "team"], s.deps);
    await runCli(["connection", "list"], s.deps);
    expect(s.out.join("\n")).toMatch(/team\s+slack\s+channels/);
    await runCli(["connection", "remove", "team"], s.deps);
    expect(s.out.join("\n")).toContain("Settings");
    const store = openStore(s.dataDir, Buffer.from(key, "base64"));
    expect(store.listConnections()).toEqual([]);
  });
});
