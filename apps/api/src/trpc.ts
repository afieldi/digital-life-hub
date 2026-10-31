import type { ApiDeps, Context, CoreDeps } from "@dlh/server";
import type { GoogleOAuth } from "./auth/google";
import { authenticate, bearerToken } from "./auth/sessions";
import type { AuthStore } from "./auth/store";
import type { Config } from "./config";

declare module "@dlh/server" {
  interface ApiDeps {
    config: Config;
    store: AuthStore;
    google: GoogleOAuth;
  }
}

export type AppDeps = CoreDeps & ApiDeps;

export async function createContext(
  deps: AppDeps,
  authorization: string | null | undefined,
): Promise<Context> {
  const token = bearerToken(authorization);
  const row = token ? await authenticate(deps.store, token, deps.now()) : null;
  return { deps, session: row ? { id: row.id, email: row.email } : null };
}
