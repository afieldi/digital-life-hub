import type { ApiDeps, Context, CoreDeps } from "@dlh/server";
import type { GoogleOAuth } from "./auth/google";
import { authenticate } from "./auth/sessions";
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
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  const row = match?.[1]
    ? await authenticate(deps.store, match[1], deps.now())
    : null;
  return { deps, session: row ? { id: row.id, email: row.email } : null };
}
