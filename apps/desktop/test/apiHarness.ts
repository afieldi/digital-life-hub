import { createTestApi } from "@dlh/api/testing";
import type { Db } from "@dlh/db";
import { createMemoryHistory } from "@tanstack/react-router";
import { type RenderResult, render } from "@testing-library/react";
import { createElement } from "react";
import { App } from "../src/App";
import { createApi } from "../src/api/client";
import { devSignIn } from "../src/auth/signIn";
import { memoryTokenStore, type TokenStore } from "../src/auth/tokenStore";
import { createAppRouter } from "../src/router";

/**
 * A desktop app wired to a real in-process API, already signed in through
 * dev sign-in as "Browser (dev)".
 */
export async function signedInApp(
  path = "/",
  opts: {
    /** Seed database for DB-backed tests. */
    db?: Db;
    /** Wraps the API fetch, e.g. to delay or fail a request. */
    wrapFetch?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch;
  } = {},
): Promise<{
  api: ReturnType<typeof createTestApi>;
  token: string;
  tokenStore: TokenStore;
  renderApp(opts?: { sessionCheckMs?: number }): RenderResult;
  router: ReturnType<typeof createAppRouter>;
}> {
  const api = createTestApi({ devAuth: true, db: opts.db });
  const { token } = await api.client().auth.devSignIn.mutate({
    device: { name: "Browser (dev)", platform: "web" },
  });
  const apiFetch = opts.wrapFetch ? opts.wrapFetch(api.fetch) : api.fetch;
  const tokenStore = memoryTokenStore(token);
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: [path] }),
  );
  const renderApp = (opts: { sessionCheckMs?: number } = {}) =>
    render(
      createElement(App, {
        router,
        auth: {
          tokenStore,
          method: devSignIn,
          api: createApi({ fetch: apiFetch, getToken: tokenStore.get }),
          sessionCheckMs: opts.sessionCheckMs,
        },
      }),
    );
  return { api, token, tokenStore, renderApp, router };
}
