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
  env_file?: string | string[];
  volumes?: string[];
  networks?: string[];
  stop_grace_period?: string;
  restart?: string;
  depends_on?: string[];
  profiles?: string[];
  command?: string[];
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

  it("the api has its own Gateway key and model, separate from the agent's", () => {
    const api = compose.services.api?.environment ?? {};
    expect(api.AI_GATEWAY_API_KEY).toBe("${API_AI_GATEWAY_API_KEY:-}");
    expect(api.AI_GATEWAY_DEFAULT_MODEL).toBe("${AI_GATEWAY_DEFAULT_MODEL:-}");
    // Two keys, so each can carry its own budget.
    expect(compose.services.agent?.environment?.AI_GATEWAY_API_KEY).toBe(
      "${AI_GATEWAY_API_KEY:?set AI_GATEWAY_API_KEY in deploy/vps/.env}",
    );
  });

  it("the slack service has no volumes, is on internal only, and is an opt-in profile that needs no Slack settings to validate", () => {
    const slack = compose.services.slack;
    expect(slack?.build?.dockerfile).toBe("apps/slack/Dockerfile");
    expect(slack?.volumes).toBeUndefined();
    expect(slack?.networks).toEqual(["internal"]);
    expect(slack?.depends_on).toEqual(["api"]);
    expect(slack?.restart).toBe("unless-stopped");
    // Opt-in, so the rest of the stack starts with no Slack settings at all.
    expect(slack?.profiles).toEqual(["slack"]);
    const env = slack?.environment ?? {};
    expect(env.HUB_API_URL).toBe("http://api:8787");
    // Empty is allowed: the runbook starts the API before the token exists.
    expect(env.HUB_SLACK_TOKEN).toBe("${HUB_SLACK_TOKEN:-}");
    for (const name of ["SLACK_APP_TOKEN", "SLACK_BOT_TOKEN"]) {
      expect(env[name], name).toBe(`\${${name}:-}`);
    }
  });

  it(".env.example lists the slack service's settings and no user token", () => {
    const example = readFileSync(join(root, "deploy/vps/.env.example"), "utf8");
    const slack = compose.services.slack?.environment ?? {};
    // Each value the service takes from .env, by name, and the count said.
    const fromEnv = Object.values(slack).flatMap(
      (v) => /^\$\{(\w+):-\}$/.exec(v)?.[1] ?? [],
    );
    for (const name of fromEnv) {
      expect(example, name).toMatch(new RegExp(`^${name}=`, "m"));
    }
    expect(example).not.toMatch(/user token|SLACK_USER_TOKEN/i);
    const words = ["", "one", "two", "three", "four", "five"];
    expect(example).toContain(
      `once the ${words[fromEnv.length]} Slack values above are set`,
    );
  });
});

describe("the Mac compose file", () => {
  const mac = parse(
    readFileSync(join(root, "deploy/mac/docker-compose.yml"), "utf8"),
  ) as Compose;
  const agent = mac.services.agent;

  it("runs only the worker, from the worker's image, with the Docker socket", () => {
    expect(Object.keys(mac.services)).toEqual(["agent"]);
    expect(agent?.build?.dockerfile).toBe("apps/agent/Dockerfile");
    expect(agent?.volumes).toContain(`${SOCKET}:${SOCKET}`);
    expect(agent?.stop_grace_period).toBe("30s");
  });

  it("keeps its data at a path inside Docker's VM, the same inside and out, so run sockets connect", () => {
    expect(agent?.volumes).toContain("/var/lib/dlh-agent:/var/lib/dlh-agent");
    expect(agent?.environment?.AGENT_DATA_DIR).toBe("/var/lib/dlh-agent");
    // Never a Mac folder: Docker Desktop can't connect a socket across the VM.
    for (const v of agent?.volumes ?? [])
      expect(v).not.toMatch(/^(\.|~|\/Users)/);
  });

  it("sets the run firewall before every start of the worker", () => {
    const script = agent?.command?.at(-1) ?? "";
    expect(agent?.command?.slice(0, 2)).toEqual(["sh", "-c"]);
    expect(script).toMatch(
      /^docker run --rm --privileged --network host dlh-runs-firewall --rules-only && exec /,
    );
    expect(script).toMatch(/src\/main\.ts$/);
  });

  it("reads the worker's own .env and needs the hub URL the script sets", () => {
    expect(agent?.env_file).toBe("../../apps/agent/.env");
    expect(agent?.environment?.API_URL).toMatch(/^\$\{AGENT_HUB_URL:\?/);
  });
});
