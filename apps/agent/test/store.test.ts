import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { openStore } from "../src/store";

const key = Buffer.alloc(32, 7);
const dir = () => mkdtempSync(join(tmpdir(), "dlh-store-"));

describe("store", () => {
  it("a secret round-trips and is not readable in the file", () => {
    const d = dir();
    const store = openStore(d, key);
    store.addConnection({
      id: "c1",
      name: "gh",
      type: "github",
      scopeSummary: "repo: read",
      secret: { token: "ghp_supersecretvalue" },
    });
    expect(store.secretOf("c1")).toEqual({ token: "ghp_supersecretvalue" });
    store.close();
    expect(readFileSync(join(d, "agent.db")).toString("latin1")).not.toContain(
      "ghp_supersecretvalue",
    );
    expect(openStore(d, key).secretOf("c1")).toEqual({
      token: "ghp_supersecretvalue",
    });
  });

  it("lists metadata only and removes by name", () => {
    const store = openStore(dir(), key);
    store.addConnection({
      id: "c1",
      name: "gh",
      type: "github",
      scopeSummary: "repo: read",
      secret: { token: "t" },
    });
    expect(store.listConnections()).toEqual([
      { id: "c1", name: "gh", type: "github", scopeSummary: "repo: read" },
    ]);
    expect(store.removeConnection("gh")).toBe(true);
    expect(store.removeConnection("gh")).toBe(false);
    expect(store.listConnections()).toEqual([]);
  });

  it("a wrong key can't decrypt", () => {
    const d = dir();
    const store = openStore(d, key);
    store.addConnection({
      id: "c1",
      name: "gh",
      type: "github",
      scopeSummary: "repo: read",
      secret: { token: "t" },
    });
    store.close();
    expect(() => openStore(d, Buffer.alloc(32, 9)).secretOf("c1")).toThrow(
      "Can't decrypt connection secrets: wrong AGENT_SECRETS_KEY",
    );
  });

  it("runs ended over 7 days ago are listed for removal", () => {
    const store = openStore(dir(), key);
    const day = 24 * 3600 * 1000;
    const now = Date.parse("2026-11-05T00:00:00Z");
    store.markStarted("old", "vol-old");
    store.markStarted("recent", "vol-recent");
    store.markStarted("live", "vol-live");
    store.markEnded("old", new Date(now - 8 * day));
    store.markEnded("recent", new Date(now - 6 * day));
    expect(store.endedBefore(new Date(now - 7 * day))).toEqual([
      { runId: "old", volume: "vol-old" },
    ]);
    store.forgetRun("old");
    expect(store.endedBefore(new Date(now - 7 * day))).toEqual([]);
  });
});
