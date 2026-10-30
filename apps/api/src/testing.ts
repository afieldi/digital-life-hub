import type { DeviceInput } from "@dlh/api-contract";
import { createTRPCClient, httpLink, type TRPCClient } from "@trpc/client";
import { createApp } from "./app";
import type { GoogleOAuth } from "./auth/google";
import { memoryAuthStore } from "./auth/memoryStore";
import type { AppRouter } from "./router";

export class FakeGoogle implements GoogleOAuth {
  identity: { email: string; emailVerified: boolean };

  constructor(email: string) {
    this.identity = { email, emailVerified: true };
  }

  authUrl(p: { state: string }): string {
    return `https://accounts.google.com/o/oauth2/v2/auth?state=${p.state}`;
  }

  async exchange(): Promise<{ email: string; emailVerified: boolean }> {
    return this.identity;
  }
}

const REDIRECT_URI = "http://127.0.0.1:5000/callback";
const DEFAULT_DEVICE: DeviceInput = { name: "Test device", platform: "macos" };

export function createTestApi(
  opts: { devAuth?: boolean; allowedEmail?: string } = {},
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
  const app = createApp({
    config: {
      port: 0,
      databaseUrl: "",
      google: { clientId: "test", clientSecret: "test" },
      allowedEmail,
      devAuth: opts.devAuth ?? false,
    },
    store,
    google,
    now: clock.now,
  });

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

  return { app, store, google, clock, fetch: fetchApi, client, signIn };
}
