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

/** A session's token signs in as you; otherwise it may be a service token. */
export async function createContext(
  deps: AppDeps,
  authorization: string | null | undefined,
): Promise<Context> {
  const token = bearerToken(authorization);
  if (!token) return { deps, session: null, principal: null };
  const row = await authenticate(deps.store, token, deps.now());
  if (row) {
    const session = { id: row.id, email: row.email };
    return { deps, session, principal: { kind: "user", session } };
  }
  const principal = await deps.store.findServiceToken(token);
  return { deps, session: null, principal };
}
