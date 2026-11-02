import { resolve } from "node:path";
import { createTestApi, freshModuleDb, serverModules } from "@dlh/api/testing";
import type { Db } from "@dlh/db";
import { createMemoryHistory } from "@tanstack/react-router";
import {
  fireEvent,
  type RenderResult,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { createElement } from "react";
import { App } from "../src/App";
import { createApi } from "../src/api/client";
import { devSignIn } from "../src/auth/signIn";
import { memoryTokenStore, type TokenStore } from "../src/auth/tokenStore";
import { createAppRouter } from "../src/router";

/**
 * A fresh test database with Core's and every module's migrations. jsdom gives
 * @dlh/db no file URL to find them from, so the root is given: tests run from apps/desktop.
 */
export const freshApiDb = () =>
  freshModuleDb([...serverModules], resolve(process.cwd(), "../.."));

/**
 * A desktop app wired to a real in-process API, already signed in through
 * dev sign-in as "Browser (dev)".
 */
export async function signedInApp(
  path = "/",
  opts: {
    /** Seed database for DB-backed tests. */
    db?: Db;
    /** Runs the server with no OpenRouter key. */
    noOpenRouter?: boolean;
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
  const api = createTestApi({
    devAuth: true,
    db: opts.db,
    noOpenRouter: opts.noOpenRouter,
  });
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

/**
 * Dismisses every toast and waits until none are left. Toasts live in a
 * module-level queue that outlives each render, and a request still in flight
 * can add one after the first dismissal, so dismiss again on every retry.
 */
export async function dismissToasts(): Promise<void> {
  await waitFor(() => {
    const open = screen.queryAllByRole("button", { name: "Dismiss" });
    for (const b of open) fireEvent.click(b);
    if (open.length > 0) throw new Error(`${open.length} toast(s) still open`);
  });
}
