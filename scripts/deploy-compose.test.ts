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
  stop_grace_period?: string;
  restart?: string;
  depends_on?: string[];
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
  it("runs db, api, agent and slack, and only agent mounts the Docker socket", () => {
    expect(Object.keys(compose.services).sort()).toEqual([
      "agent",
      "api",
      "db",
      "slack",
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
    // Long enough for the worker to stop its run containers (10 s each, at
    // once) and remove them before Docker kills it.
    expect(compose.services.agent?.stop_grace_period).toBe("30s");
    // Empty is allowed: the runbook starts db and api before the token exists.
    expect(compose.services.agent?.environment?.AGENT_WORKER_TOKEN).toBe(
      "${AGENT_WORKER_TOKEN:-}",
    );
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

  it("the slack service has no volumes, is on internal only, and requires the Slack tokens", () => {
    const slack = compose.services.slack;
    expect(slack?.build?.dockerfile).toBe("apps/slack/Dockerfile");
    expect(slack?.volumes).toBeUndefined();
    expect(slack?.networks).toEqual(["internal"]);
    expect(slack?.depends_on).toEqual(["api"]);
    expect(slack?.restart).toBe("unless-stopped");
    const env = slack?.environment ?? {};
    expect(env.HUB_API_URL).toBe("http://api:8787");
    // Empty is allowed: the runbook starts the API before the token exists.
    expect(env.HUB_SLACK_TOKEN).toBe("${HUB_SLACK_TOKEN:-}");
    for (const name of [
      "SLACK_APP_TOKEN",
      "SLACK_BOT_TOKEN",
      "SLACK_USER_TOKEN",
    ]) {
      expect(env[name], name).toMatch(new RegExp(`^\\$\\{${name}:\\?`));
    }
  });
});
