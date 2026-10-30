import type { AppRouter as ApiRouter } from "@dlh/api/router";
import type { DeviceInput, Platform } from "@dlh/api-contract";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { hostname, platform } from "@tauri-apps/plugin-os";
import { type TRPCClient, TRPCClientError } from "@trpc/client";

/** Signs in against the API and resolves to the new session token. */
export type SignInMethod = (client: TRPCClient<ApiRouter>) => Promise<string>;

export type SignInFailure =
  | "cancelled"
  | "denied"
  | "timeout"
  | "forbidden"
  | "expired"
  | "network";

export class SignInError extends Error {
  readonly reason: SignInFailure;

  constructor(reason: SignInFailure, options?: { cause?: unknown }) {
    super(`Sign-in failed: ${reason}`, options);
    this.name = "SignInError";
    this.reason = reason;
  }
}

/** Map a Rust loopback error string, a tRPC error or a fetch failure to a reason. */
export function toSignInError(err: unknown): SignInError {
  if (err instanceof SignInError) return err;
  if (typeof err === "string") {
    if (err === "denied" || err === "cancelled" || err === "timeout") {
      return new SignInError(err, { cause: err });
    }
    console.warn("Sign-in failed with an unrecognised error:", err);
    return new SignInError("expired", { cause: err });
  }
  if (err instanceof TRPCClientError) {
    // No `data` means the request never got a tRPC response.
    if (!err.data) return new SignInError("network", { cause: err });
    if (err.data.code === "FORBIDDEN") {
      return new SignInError("forbidden", { cause: err });
    }
    return new SignInError("expired", { cause: err });
  }
  if (err instanceof TypeError)
    return new SignInError("network", { cause: err });
  console.warn("Sign-in failed with an unrecognised error:", err);
  return new SignInError("expired", { cause: err });
}

async function thisDevice(): Promise<DeviceInput> {
  let host: string | null = null;
  try {
    host = await hostname();
  } catch {
    // A missing permission or plugin failure must not fail sign-in.
  }
  const name = host?.trim().slice(0, 100).trim() || "This computer";
  const os = platform();
  const devicePlatform: Platform =
    os === "macos" || os === "windows" ? os : "web";
  return { name, platform: devicePlatform };
}

/** Google OAuth through the system browser and the Tauri loopback listener. */
export const googleSignIn: SignInMethod = async (client) => {
  try {
    const { port, attempt } = await invoke<{ port: number; attempt: number }>(
      "auth_loopback_start",
    );
    const { authUrl, state } = await client.auth.start.mutate({
      redirectUri: `http://127.0.0.1:${port}/callback`,
    });
    await openUrl(authUrl);
    const code = await invoke<string>("auth_loopback_wait", {
      attempt,
      expectedState: state,
    });
    const { token } = await client.auth.exchange.mutate({
      state,
      code,
      device: await thisDevice(),
    });
    return token;
  } catch (err) {
    throw toSignInError(err);
  }
};

/** Browser dev mode: the API's dev-only sign-in (NOT_FOUND unless DEV_AUTH). */
export const devSignIn: SignInMethod = async (client) => {
  try {
    const { token } = await client.auth.devSignIn.mutate({
      device: { name: "Browser (dev)", platform: "web" },
    });
    return token;
  } catch (err) {
    throw toSignInError(err);
  }
};
