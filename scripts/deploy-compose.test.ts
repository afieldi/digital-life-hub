import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

type Service = {
  image?: string;
  build?: { context: string; dockerfile: string };
  environment?: Record<string, string>;
  env_file?: string[];
  volumes?: string[];
  networks?: string[];
};
type Compose = {
  services: Record<string, Service>;
  networks: Record<string, { external?: boolean; name?: string }>;
};

const compose = parse(
  readFileSync(join(root, "deploy/vps/docker-compose.yml"), "utf8"),
) as Compose;
const SOCKET = "/var/run/docker.sock";

describe("the VPS compose file", () => {
  it("runs db, api and agent, and only agent mounts the Docker socket", () => {
    expect(Object.keys(compose.services).sort()).toEqual([
      "agent",
      "api",
      "db",
    ]);
    expect(compose.services.db?.image).toBe("postgres:18");
    expect(compose.services.api?.build?.dockerfile).toBe("apps/api/Dockerfile");
    expect(compose.services.agent?.build?.dockerfile).toBe(
      "apps/agent/Dockerfile",
    );
    const mounting = Object.entries(compose.services)
      .filter(([, s]) => s.volumes?.some((v) => v.startsWith(`${SOCKET}:`)))
      .map(([name]) => name);
    expect(mounting).toEqual(["agent"]);
  });

  it("bind-mounts the agent data dir at the same path, so run sockets resolve on the host", () => {
    expect(compose.services.agent?.volumes).toContain(
      "/var/lib/dlh-agent:/var/lib/dlh-agent",
    );
    expect(compose.services.agent?.environment?.API_URL).toBe(
      "http://api:8787",
    );
    expect(compose.services.api?.environment?.MIGRATE_ON_START).toBe("1");
  });

  it("keeps db, api and agent on internal, with dlh-runs external", () => {
    for (const name of ["db", "api", "agent"]) {
      expect(compose.services[name]?.networks, name).toEqual(["internal"]);
    }
    expect(compose.networks["dlh-runs"]).toMatchObject({
      external: true,
      name: "dlh-runs",
    });
    expect(compose.networks.internal?.external).toBeUndefined();
  });
});
