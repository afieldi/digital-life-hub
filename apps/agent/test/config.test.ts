import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const key = Buffer.alloc(32, 7).toString("base64");
const env = {
  API_URL: "http://127.0.0.1:8787",
  AGENT_WORKER_TOKEN: "w-token",
  AI_GATEWAY_API_KEY: "gw-key",
  AGENT_SECRETS_KEY: key,
};

describe("loadConfig", () => {
  it("reads the required fields and defaults the data dir", () => {
    const c = loadConfig(env);
    expect(c.apiUrl).toBe("http://127.0.0.1:8787");
    expect(c.workerToken).toBe("w-token");
    expect(c.dataDir).toBe("/var/lib/dlh-agent");
  });

  it("the gateway URL defaults to the Claude Code endpoint", () => {
    expect(loadConfig(env).gatewayUrl).toBe(
      "https://ai-gateway.vercel.sh/claude-code",
    );
  });

  it("the runner image defaults and can be set", () => {
    expect(loadConfig(env).image).toBe("dlh-agent-runner");
    expect(loadConfig({ ...env, AGENT_RUNNER_IMAGE: "x:1" }).image).toBe("x:1");
  });

  it("a short secrets key is refused", () => {
    const short = Buffer.alloc(16, 7).toString("base64");
    expect(() => loadConfig({ ...env, AGENT_SECRETS_KEY: short })).toThrow();
  });

  it("a missing worker token is refused", () => {
    const { AGENT_WORKER_TOKEN: _, ...rest } = env;
    expect(() => loadConfig(rest)).toThrow();
  });
});
