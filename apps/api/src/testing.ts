import type { DeviceInput } from "@dlh/api-contract";
import type { Db } from "@dlh/db";
import {
  createCoreDeps,
  type OperationsRouter,
  type ServerModule,
} from "@dlh/server";
import { FakeProvider, type fixtureServer } from "@dlh/server/testing";

export { fixtureServer, freshModuleDb } from "@dlh/server/testing";
export { serverModules };

import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
import type { AnyRouter } from "@trpc/server";
import { createApp } from "./app";
import type { GoogleOAuth } from "./auth/google";
import { memoryAuthStore } from "./auth/memoryStore";
import { serverModules } from "./modules.gen";
import { type AppRouter, composeApi } from "./router";

export class FakeGoogle implements GoogleOAuth {
  identity: { email: string; emailVerified: boolean };

  constructor(email: string) {
    this.identity = { email, emailVerified: true };
  }

  lastAuthUrlArgs: Parameters<GoogleOAuth["authUrl"]>[0] | null = null;
  lastExchangeArgs: Parameters<GoogleOAuth["exchange"]>[0] | null = null;

  authUrl(p: Parameters<GoogleOAuth["authUrl"]>[0]): string {
    this.lastAuthUrlArgs = p;
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${p.state}`;
  }

  async exchange(
    p: Parameters<GoogleOAuth["exchange"]>[0],
  ): Promise<{ email: string; emailVerified: boolean }> {
    this.lastExchangeArgs = p;
    return this.identity;
  }
}

const REDIRECT_URI = "http://127.0.0.1:5000/callback";
const DEFAULT_DEVICE: DeviceInput = { name: "Test device", platform: "macos" };

function noDb(): Db {
  return new Proxy({} as Db, {
    get() {
      throw new Error(
        "createTestApi: no database — pass { db } (DB tests only)",
      );
    },
  });
}

/** The router `createTestApi({ modules })` serves: the API's modules, then `Extra`. */
export type TestApiRouter<Extra extends readonly ServerModule[]> = ReturnType<
  typeof composeApi<[...typeof serverModules, ...Extra]>
>["router"];

/** The fixture module's router, as a desktop test page calls it. */
export type FixtureRouter = OperationsRouter<typeof fixtureServer.operations>;

/** A client for the API with the fixture module mounted. */
export type FixtureClient = TRPCClient<TestApiRouter<[typeof fixtureServer]>>;

export function createTestApi(
  opts: {
    /** Modules mounted beside the API's own, e.g. `fixtureServer`; reach them with `clientAs`. */
    modules?: readonly ServerModule[];
    devAuth?: boolean;
    allowedEmail?: string;
    db?: Db;
    itemTypes?: string[];
    aiProvider?: FakeProvider;
    noOpenRouter?: boolean;
  } = {},
) {
  const allowedEmail = opts.allowedEmail ?? "arek@example.com";
  let time = new Date("2026-10-30T12:00:00.000Z").getTime();
  const clock = {
    now: () => new Date(time),
    advance: (ms: number) => {
      time += ms;
    },
  };
  const store = memoryAuthStore();
  const google = new FakeGoogle(allowedEmail);
  const devAuth = opts.devAuth ?? false;
  // OpenRouter in tests: queue model outputs on `ai`.
  const ai = opts.aiProvider ?? new FakeProvider();
  const api = composeApi([...serverModules, ...(opts.modules ?? [])]);
  const core = createCoreDeps(api.composed, {
    db: opts.db ?? noDb(),
    now: clock.now,
    devErrors: devAuth,
    ai: {
      providers: opts.noOpenRouter ? {} : { openrouter: ai },
      defaultModel: "test-model",
    },
  });
  const deps = {
    ...core,
    itemTypes: new Set([...core.itemTypes, ...(opts.itemTypes ?? [])]),
    config: {
      port: 0,
      host: "127.0.0.1",
      databaseUrl: "",
      google: { clientId: "test", clientSecret: "test" },
      allowedEmail,
      devAuth,
      aiFake: false,
      migrateOnStart: false,
      migrationsRoot: null,
      openrouter: { apiKey: null, defaultModel: null },
    },
    store,
    google,
  };
  const app = createApp(deps, api.router);

  const fetchApi: typeof fetch = (input, init) =>
    Promise.resolve(app.fetch(new Request(input, init)));

  const links = (token?: string) => [
    httpLink({
      url: "http://api.test/trpc",
      fetch: fetchApi,
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  ];
  const client = (token?: string): TRPCClient<AppRouter> =>
    createTRPCClient<AppRouter>({ links: links(token) });
  /** A client typed for the extra `modules`: `clientAs<TestApiRouter<[typeof m]>>(token)`. */
  const clientAs = <R extends AnyRouter>(token?: string): TRPCClient<R> =>
    createTRPCClient<R>({ links: links(token) });

  const signIn = async (device: DeviceInput = DEFAULT_DEVICE) => {
    const c = client();
    const { state } = await c.auth.start.mutate({ redirectUri: REDIRECT_URI });
    const { token } = await c.auth.exchange.mutate({
      state,
      code: "test-code",
      device,
    });
    return token;
  };

  return {
    app,
    deps,
    store,
    google,
    ai,
    clock,
    fetch: fetchApi,
    client,
    clientAs,
    signIn,
  };
}
