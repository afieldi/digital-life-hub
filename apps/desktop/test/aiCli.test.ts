import { afterEach, vi } from "vitest";

const tauri = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  invoke: vi.fn(),
}));
vi.mock("@tauri-apps/api/core", () => tauri);

import {
  CliError,
  cliErrorToAi,
  cliPathOverride,
  cliStatus,
  runCli,
  setCliRunnerForTests,
} from "../src/ai/cli";

afterEach(() => {
  setCliRunnerForTests(null);
  tauri.isTauri.mockReturnValue(false);
  tauri.invoke.mockReset();
  localStorage.clear();
});

const req = {
  runId: "r1",
  provider: "claude-cli" as const,
  pathOverride: null,
  system: "sys",
  prompt: "prompt",
  schema: "{}",
};

test("in Tauri, runs the Rust command with its provider name and maps the result", async () => {
  tauri.isTauri.mockReturnValue(true);
  tauri.invoke.mockResolvedValue({ stdout: "{}", exit_code: 3 });
  await expect(
    runCli({ ...req, provider: "codex-cli", pathOverride: "/bin/codex" }),
  ).resolves.toEqual({ stdout: "{}", exitCode: 3 });
  expect(tauri.invoke).toHaveBeenCalledWith("ai_cli_run", {
    runId: "r1",
    provider: "codex",
    pathOverride: "/bin/codex",
    system: "sys",
    prompt: "prompt",
    schema: "{}",
  });
});

test("in Tauri, status maps snake_case fields", async () => {
  tauri.isTauri.mockReturnValue(true);
  tauri.invoke.mockResolvedValue({
    installed: true,
    signed_in: false,
    version: "1.2.3",
  });
  await expect(cliStatus("claude-cli", null)).resolves.toEqual({
    installed: true,
    signedIn: false,
    version: "1.2.3",
  });
  expect(tauri.invoke).toHaveBeenCalledWith("ai_cli_status", {
    provider: "claude",
    pathOverride: null,
  });
});

test("a Rust error rejects as a CliError with its code", async () => {
  tauri.isTauri.mockReturnValue(true);
  tauri.invoke.mockRejectedValue({ code: "timeout", message: "took too long" });
  const err = await runCli(req).catch((e) => e);
  expect(err).toBeInstanceOf(CliError);
  expect(err.code).toBe("timeout");
});

test("outside Tauri, the CLIs are not installed", async () => {
  const err = await runCli(req).catch((e) => e);
  expect(err).toBeInstanceOf(CliError);
  expect(err.code).toBe("not_installed");
  await expect(cliStatus("claude-cli", null)).resolves.toMatchObject({
    installed: false,
  });
  expect(tauri.invoke).not.toHaveBeenCalled();
});

test("a test runner replaces the real one", async () => {
  const run = vi.fn().mockResolvedValue({ stdout: "x", exitCode: 0 });
  setCliRunnerForTests({
    run,
    status: vi.fn(),
    cancel: vi.fn(),
  });
  await expect(runCli(req)).resolves.toEqual({ stdout: "x", exitCode: 0 });
  expect(run).toHaveBeenCalledWith(req);
});

test("Rust errors map to the gateway's messages", () => {
  const e = (code: CliError["code"], message = "") =>
    new CliError(code, message);
  expect(cliErrorToAi(e("not_installed"), "claude-cli")).toEqual({
    code: "provider_unavailable",
    message: "Claude Code isn't installed on this computer.",
  });
  expect(cliErrorToAi(e("timeout"), "codex-cli")).toEqual({
    code: "timeout",
    message: "Codex didn't answer within 120 seconds.",
  });
  expect(
    cliErrorToAi(e("too_large", "\nOutput too large.\nmore"), "claude-cli"),
  ).toEqual({
    code: "provider_error",
    message: "Claude Code returned an error: Output too large.",
  });
  expect(cliErrorToAi(e("spawn_failed", "no exec"), "codex-cli")).toEqual({
    code: "provider_error",
    message: "Codex returned an error: no exec.",
  });
  expect(cliErrorToAi(e("cancelled"), "claude-cli")).toBeNull();
});

test("the path override is read from local storage per provider", () => {
  expect(cliPathOverride("claude-cli")).toBeNull();
  localStorage.setItem("dlh.ai.cliPath.claude-cli", "/opt/claude");
  expect(cliPathOverride("claude-cli")).toBe("/opt/claude");
  expect(cliPathOverride("codex-cli")).toBeNull();
});
