import type { AiErrorData } from "@dlh/core";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { PROVIDER_NAMES } from "./providers";

/** Server ids of the providers the app runs itself. */
export type CliProviderId = "claude-cli" | "codex-cli";

export type CliRunInput = {
  /** Lets `cancelCli` find the run. */
  runId: string;
  provider: CliProviderId;
  /** Absolute path to the program, or null to search for it. */
  pathOverride: string | null;
  system: string;
  prompt: string;
  /** The output JSON Schema, serialised. */
  schema: string;
};

export type CliOutput = { stdout: string; exitCode: number };
export type CliStatus = {
  installed: boolean;
  signedIn: boolean;
  version: string | null;
};

const CLI_ERROR_CODES = [
  "not_installed",
  "timeout",
  "too_large",
  "spawn_failed",
  "cancelled",
] as const;

/** A failure from the Rust runner (`{ code, message }`). */
export class CliError extends Error {
  constructor(
    readonly code: (typeof CLI_ERROR_CODES)[number],
    message: string,
  ) {
    super(message);
    this.name = "CliError";
  }
}

export interface CliRunner {
  run(input: CliRunInput): Promise<CliOutput>;
  status(
    provider: CliProviderId,
    pathOverride: string | null,
  ): Promise<CliStatus>;
  cancel(runId: string): Promise<void>;
}

/** The Rust commands take the program's own name. */
const PROGRAM: Record<CliProviderId, "claude" | "codex"> = {
  "claude-cli": "claude",
  "codex-cli": "codex",
};

/** Tauri camelCases argument names but returns the Rust structs' snake_case fields. */
const tauriRunner: CliRunner = {
  async run(input) {
    const out = await invoke<{ stdout: string; exit_code: number }>(
      "ai_cli_run",
      { ...input, provider: PROGRAM[input.provider] },
    );
    return { stdout: out.stdout, exitCode: out.exit_code };
  },
  async status(provider, pathOverride) {
    const s = await invoke<{
      installed: boolean;
      signed_in: boolean;
      version: string | null;
    }>("ai_cli_status", { provider: PROGRAM[provider], pathOverride });
    return {
      installed: s.installed,
      signedIn: s.signed_in,
      version: s.version ?? null,
    };
  },
  async cancel(runId) {
    await invoke("ai_cli_cancel", { runId });
  },
};

/** Browser dev mode: there is no way to run a program, so none is installed. */
const browserRunner: CliRunner = {
  run: async () => {
    throw new CliError("not_installed", "Not running in the desktop app.");
  },
  status: async () => ({ installed: false, signedIn: false, version: null }),
  cancel: async () => {},
};

let testRunner: CliRunner | null = null;

/** Replaces the runner in tests; null restores the real one. */
export function setCliRunnerForTests(runner: CliRunner | null): void {
  testRunner = runner;
}

function runner(): CliRunner {
  return testRunner ?? (isTauri() ? tauriRunner : browserRunner);
}

function toCliError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (typeof e === "object" && e !== null && "code" in e) {
    const { code, message } = e as { code: unknown; message?: unknown };
    const known = CLI_ERROR_CODES.find((c) => c === code);
    if (known) return new CliError(known, String(message ?? ""));
  }
  const message = e instanceof Error ? e.message : String(e);
  return new CliError("spawn_failed", message);
}

/** Runs a CLI with a prepared request; rejects with a `CliError`. */
export async function runCli(input: CliRunInput): Promise<CliOutput> {
  try {
    return await runner().run(input);
  } catch (e) {
    throw toCliError(e);
  }
}

export async function cliStatus(
  provider: CliProviderId,
  pathOverride: string | null,
): Promise<CliStatus> {
  try {
    return await runner().status(provider, pathOverride);
  } catch (e) {
    throw toCliError(e);
  }
}

export async function cancelCli(runId: string): Promise<void> {
  await runner().cancel(runId);
}

/** Local storage key for this device's program path for `provider`. */
export function cliPathKey(provider: CliProviderId): string {
  return `dlh.ai.cliPath.${provider}`;
}

export function cliPathOverride(provider: CliProviderId): string | null {
  try {
    return localStorage.getItem(cliPathKey(provider)) || null;
  } catch {
    return null;
  }
}

export type StoredCliStatus = CliStatus & { checkedAt: string };

export function cliStatusKey(provider: CliProviderId): string {
  return `dlh.ai.cliStatus.${provider}`;
}

/** The last status check made on this device, if one was kept. */
export function storedCliStatus(
  provider: CliProviderId,
): StoredCliStatus | null {
  try {
    const raw = localStorage.getItem(cliStatusKey(provider));
    if (!raw) return null;
    const v: unknown = JSON.parse(raw);
    if (
      typeof v === "object" &&
      v !== null &&
      "installed" in v &&
      "signedIn" in v &&
      "checkedAt" in v &&
      typeof v.installed === "boolean" &&
      typeof v.signedIn === "boolean" &&
      typeof v.checkedAt === "string"
    ) {
      const version =
        "version" in v && typeof v.version === "string" ? v.version : null;
      return {
        installed: v.installed,
        signedIn: v.signedIn,
        version,
        checkedAt: v.checkedAt,
      };
    }
  } catch {
    // Unreadable storage or JSON: treat as never checked.
  }
  return null;
}

export function saveCliStatus(
  provider: CliProviderId,
  status: StoredCliStatus,
): void {
  try {
    localStorage.setItem(cliStatusKey(provider), JSON.stringify(status));
  } catch {
    // Storage unavailable: the status just isn't remembered.
  }
}

const CLI_TIMEOUT_SECONDS = 120;

function firstLine(text: string): string {
  const line = (text.split("\n").find((l) => l.trim() !== "") ?? "")
    .trim()
    .replace(/\.$/, "");
  return line || "unknown error";
}

/** The message shown for a failed run, or null when it was cancelled. */
export function cliErrorToAi(
  e: unknown,
  provider: CliProviderId,
): AiErrorData | null {
  const err = toCliError(e);
  const name = PROVIDER_NAMES[provider];
  switch (err.code) {
    case "cancelled":
      return null;
    case "not_installed":
      return {
        code: "provider_unavailable",
        message: `${name} isn't installed on this computer.`,
      };
    case "timeout":
      return {
        code: "timeout",
        message: `${name} didn't answer within ${CLI_TIMEOUT_SECONDS} seconds.`,
      };
    case "too_large":
    case "spawn_failed":
      return {
        code: "provider_error",
        message: `${name} returned an error: ${firstLine(err.message)}.`,
      };
  }
}
