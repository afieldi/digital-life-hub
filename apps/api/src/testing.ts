import type { DeviceInput } from "@dlh/api-contract";
import type { Db } from "@dlh/db";
import {
  CORE_ROUTER_IDS,
  collectServerModules,
  coreAi,
  createChangeBus,
} from "@dlh/server";
import { FakeProvider } from "@dlh/server/testing";
import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
import { createApp } from "./app";
import type { GoogleOAuth } from "./auth/google";
import { memoryAuthStore } from "./auth/memoryStore";
import { serverModules } from "./modules.gen";
import type { AppRouter } from "./router";

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

export function createTestApi(
  opts: {
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
  const collected = collectServerModules(
    [...serverModules],
    [...CORE_ROUTER_IDS],
    coreAi,
  );
  // OpenRouter in tests: queue model outputs on `ai`.
  const ai = opts.aiProvider ?? new FakeProvider();
  const deps = {
    db: opts.db ?? noDb(),
    changes: createChangeBus(),
    itemTypes: new Set([...collected.itemTypes, ...(opts.itemTypes ?? [])]),
    devErrors: devAuth,
    config: {
      port: 0,
      databaseUrl: "",
      google: { clientId: "test", clientSecret: "test" },
      allowedEmail,
      devAuth,
      openrouter: { apiKey: null, defaultModel: null },
    },
    store,
    google,
    now: clock.now,
    ai: {
      runners: collected.aiRunners,
      descriptions: [...collected.aiRunners.values()].map((r) => r.action),
      providers: opts.noOpenRouter ? {} : { openrouter: ai },
      defaultModel: "test-model",
    },
  };
  const app = createApp(deps);

  const fetchApi: typeof fetch = (input, init) =>
    Promise.resolve(app.fetch(new Request(input, init)));

  const client = (token?: string): TRPCClient<AppRouter> =>
    createTRPCClient<AppRouter>({
      links: [
        httpLink({
          url: "http://api.test/trpc",
          fetch: fetchApi,
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        }),
      ],
    });

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
    signIn,
  };
}
