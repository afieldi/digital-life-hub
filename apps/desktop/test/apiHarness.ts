import { resolve } from "node:path";
import {
  createTestApi,
  type FixtureClient,
  fixtureServer,
  freshModuleDb,
  serverModules,
  type TestApiRouter,
} from "@dlh/api/testing";
import { collectModules } from "@dlh/core";
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
import { onTestFinished, vi } from "vitest";
import { App } from "../src/App";
import { createApi } from "../src/api/client";
import { devSignIn } from "../src/auth/signIn";
import { memoryTokenStore, type TokenStore } from "../src/auth/tokenStore";
import { registry, SHELL_RESERVED } from "../src/modules";
import { createAppRouter } from "../src/router";
import { fixtureManifest } from "./fixture/manifest";

/** The app's registry with the test-only fixture module added. */
export const registryWithFixture = collectModules(
  [...registry.modules, fixtureManifest],
  SHELL_RESERVED,
);

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
    /** Mounts the test-only fixture module (item type `fixture`) on both sides. */
    fixture?: boolean;
    /**
     * The device's clock for this test: `Date` reads it (timers still run).
     * Restored when the test ends.
     */
    now?: Date;
    /** The device's zone for this test (`TZ`), restored when the test ends. */
    timeZone?: string;
    /** Wraps the API fetch, e.g. to delay or fail a request. */
    wrapFetch?: (fetch: typeof globalThis.fetch) => typeof globalThis.fetch;
    /** Builds the router in place of the app's own, e.g. to mount one component. */
    createRouter?: (
      history: ReturnType<typeof createMemoryHistory>,
    ) => ReturnType<typeof createAppRouter>;
  } = {},
): Promise<{
  api: ReturnType<typeof createTestApi>;
  token: string;
  tokenStore: TokenStore;
  renderApp(opts?: { sessionCheckMs?: number }): RenderResult;
  router: ReturnType<typeof createAppRouter>;
  /** A client that also reaches `fixture.*` (with `fixture: true`). */
  fixture: FixtureClient;
}> {
  if (opts.timeZone) {
    const host = process.env.TZ;
    // Node applies a new TZ to Date and Intl at once.
    process.env.TZ = opts.timeZone;
    onTestFinished(() => {
      if (host === undefined) delete process.env.TZ;
      else process.env.TZ = host;
    });
  }
  if (opts.now) {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(opts.now);
    onTestFinished(() => {
      vi.useRealTimers();
    });
  }
  const api = createTestApi({
    devAuth: true,
    db: opts.db,
    noOpenRouter: opts.noOpenRouter,
    modules: opts.fixture ? [fixtureServer] : [],
  });
  const { token } = await api.client().auth.devSignIn.mutate({
    device: { name: "Browser (dev)", platform: "web" },
  });
  const apiFetch = opts.wrapFetch ? opts.wrapFetch(api.fetch) : api.fetch;
  const tokenStore = memoryTokenStore(token);
  const history = createMemoryHistory({ initialEntries: [path] });
  const router = opts.createRouter
    ? opts.createRouter(history)
    : createAppRouter(history, opts.fixture ? registryWithFixture : registry);
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
  const fixture = api.clientAs<TestApiRouter<[typeof fixtureServer]>>(token);
  return { api, token, tokenStore, renderApp, router, fixture };
}

/** A fixture item (type `fixture`), created through `fixture.create`. */
export async function createFixture(
  client: FixtureClient,
  input: { title: string },
) {
  return (await client.fixture.create.mutate(input)).result;
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
