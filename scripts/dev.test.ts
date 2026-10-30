import { describe, expect, it } from "vitest";
import {
  API_ENV_MESSAGE,
  CARGO_MISSING_MESSAGE,
  DOCKER_DOWN_MESSAGE,
  DOCKER_MISSING_MESSAGE,
  NODE_MODULES_MESSAGE,
  preflight,
  runSteps,
  steps,
} from "./dev";

const ok = {
  hasNodeModules: () => true,
  hasCargo: () => true,
  hasDocker: () => true,
  dockerRunning: () => true,
  hasApiEnv: () => true,
};

describe("preflight", () => {
  it("fails with the install message when node_modules is missing", () => {
    const r = preflight({ ...ok, hasNodeModules: () => false });
    expect(r).toEqual({ ok: false, message: 'Run "pnpm install" first.' });
    expect(NODE_MODULES_MESSAGE).toBe('Run "pnpm install" first.');
  });

  it("fails with the Rust message when cargo is missing", () => {
    const r = preflight({ ...ok, hasCargo: () => false });
    expect(r).toEqual({ ok: false, message: CARGO_MISSING_MESSAGE });
    expect(CARGO_MISSING_MESSAGE).toContain("https://rustup.rs");
    expect(CARGO_MISSING_MESSAGE).toContain("dev:web");
  });

  it("checks node_modules before cargo", () => {
    const r = preflight({
      ...ok,
      hasNodeModules: () => false,
      hasCargo: () => false,
    });
    expect(r).toEqual({ ok: false, message: NODE_MODULES_MESSAGE });
  });

  it("reports Docker missing from PATH", () => {
    const r = preflight({ ...ok, hasDocker: () => false });
    expect(r).toEqual({ ok: false, message: DOCKER_MISSING_MESSAGE });
    expect(DOCKER_MISSING_MESSAGE).toBe(
      "Docker is not installed — install Docker Desktop (https://www.docker.com/products/docker-desktop/).",
    );
  });

  it("Docker not running is reported before anything starts", () => {
    expect(preflight({ ...ok, dockerRunning: () => false })).toEqual({
      ok: false,
      message: DOCKER_DOWN_MESSAGE,
    });
    expect(DOCKER_DOWN_MESSAGE).toBe(
      "Docker isn't running — start Docker Desktop, then run pnpm dev again.",
    );
  });

  it("missing apps/api/.env is reported", () => {
    expect(preflight({ ...ok, hasApiEnv: () => false })).toEqual({
      ok: false,
      message: API_ENV_MESSAGE,
    });
    expect(API_ENV_MESSAGE).toBe(
      "Copy apps/api/.env.example to apps/api/.env and fill in the Google client and ALLOWED_EMAIL.",
    );
  });

  it("checks cargo, then docker, then docker running, then the API env", () => {
    const none = {
      hasNodeModules: () => true,
      hasCargo: () => false,
      hasDocker: () => false,
      dockerRunning: () => false,
      hasApiEnv: () => false,
    };
    expect(preflight(none)).toEqual({
      ok: false,
      message: CARGO_MISSING_MESSAGE,
    });
    expect(preflight({ ...none, hasCargo: () => true })).toEqual({
      ok: false,
      message: DOCKER_MISSING_MESSAGE,
    });
    expect(
      preflight({ ...none, hasCargo: () => true, hasDocker: () => true }),
    ).toEqual({
      ok: false,
      message: DOCKER_DOWN_MESSAGE,
    });
  });

  it("passes when everything is present", () => {
    expect(preflight(ok)).toEqual({ ok: true });
  });
});

describe("steps", () => {
  it("steps run db → migrate → apps", () => {
    expect(steps.map((s) => s.name)).toEqual(["db", "migrate", "apps"]);
  });
});

describe("runSteps", () => {
  const log = () => {
    const calls: string[] = [];
    const step = (name: string, result: "done" | "interrupted" | Error) => ({
      name,
      run: async () => {
        calls.push(name);
        if (result instanceof Error) throw result;
        return result;
      },
    });
    return { calls, step };
  };

  it("runs every step in order and exits 0", async () => {
    const { calls, step } = log();
    const code = await runSteps(
      [step("a", "done"), step("b", "done")],
      () => {},
      () => {},
    );
    expect(calls).toEqual(["a", "b"]);
    expect(code).toBe(0);
  });

  it("an interrupt during step 1 means step 2 never runs (exit 130)", async () => {
    const { calls, step } = log();
    const code = await runSteps(
      [step("db", "interrupted"), step("migrate", "done")],
      () => {},
      () => {},
    );
    expect(calls).toEqual(["db"]);
    expect(code).toBe(130);
  });

  it("Ctrl+C ending the last step exits 0", async () => {
    const { step } = log();
    const code = await runSteps(
      [step("db", "done"), step("apps", "interrupted")],
      () => {},
      () => {},
    );
    expect(code).toBe(0);
  });

  it("a rejected step prints its message and exits non-zero", async () => {
    const { calls, step } = log();
    const errors: string[] = [];
    const code = await runSteps(
      [step("db", new Error("boom")), step("migrate", "done")],
      () => {},
      (m) => errors.push(m),
    );
    expect(calls).toEqual(["db"]);
    expect(errors).toEqual(["boom"]);
    expect(code).toBe(1);
  });
});
