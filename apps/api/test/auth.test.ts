import { codeChallengeS256 } from "../src/auth/tokens";
import { createTestApi } from "../src/testing";

const device = { name: "Arek's Mac", platform: "macos" as const };
const redirectUri = "http://127.0.0.1:5000/callback";
const EXPIRED = "Sign-in expired — try again.";
const NOT_ALLOWED = "That Google account isn't allowed to use this hub.";

test("start → exchange issues a token that auth.me accepts", async () => {
  const api = createTestApi();
  const token = await api.signIn(device);
  expect(await api.client(token).auth.me.query()).toMatchObject({
    email: "arek@example.com",
  });
});

test("auth.start accepts only http://127.0.0.1:<1-65535>/callback", async () => {
  const api = createTestApi();
  const start = (uri: string) =>
    api.client().auth.start.mutate({ redirectUri: uri });
  for (const bad of [
    "http://localhost:5000/callback",
    "https://127.0.0.1:5000/callback",
    "http://127.0.0.1:0/callback",
    "http://127.0.0.1:65536/callback",
    "http://127.0.0.1:5000/other",
  ]) {
    await expect(start(bad)).rejects.toMatchObject({
      data: { code: "BAD_REQUEST" },
    });
  }
  await expect(
    start("http://127.0.0.1:65535/callback"),
  ).resolves.toHaveProperty("state");
});

test("the attempt's verifier and redirectUri reach Google", async () => {
  const api = createTestApi();
  const client = api.client();
  const { state } = await client.auth.start.mutate({ redirectUri });
  const attempt = await api.store.takeLoginAttempt(state, api.clock.now());
  if (!attempt) throw new Error("attempt missing");
  expect(api.google.lastAuthUrlArgs).toEqual({
    state,
    codeChallenge: codeChallengeS256(attempt.codeVerifier),
    redirectUri,
  });
  // put it back, since taking it consumed it
  await api.store.putLoginAttempt(attempt, api.clock.now());
  await client.auth.exchange.mutate({ state, code: "the-code", device });
  expect(api.google.lastExchangeArgs).toEqual({
    code: "the-code",
    codeVerifier: attempt.codeVerifier,
    redirectUri,
  });
});

test("a Google failure becomes BAD_GATEWAY with no internals, logged server-side", async () => {
  const api = createTestApi({ devAuth: false });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  api.google.exchange = async () => {
    throw new Error("secret-internal invalid_grant");
  };
  const client = api.client();
  const { state } = await client.auth.start.mutate({ redirectUri });
  const err = await client.auth.exchange
    .mutate({ state, code: "c", device })
    .catch((e: unknown) => e);
  expect(err).toMatchObject({
    message: "Google sign-in failed — try again.",
    data: { code: "BAD_GATEWAY" },
  });
  expect((err as { data: Record<string, unknown> }).data).not.toHaveProperty(
    "stack",
  );
  expect(JSON.stringify(err)).not.toContain("secret-internal");
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

test("internal errors carry no stack when devAuth is off", async () => {
  const api = createTestApi({ devAuth: false });
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  api.store.listActiveSessions = async () => {
    throw new Error("db exploded");
  };
  const token = await api.signIn(device);
  const err = await api
    .client(token)
    .devices.list.query()
    .catch((e: unknown) => e);
  expect(err).toMatchObject({ data: { code: "INTERNAL_SERVER_ERROR" } });
  expect((err as { data: Record<string, unknown> }).data).not.toHaveProperty(
    "stack",
  );
  expect(log).toHaveBeenCalled();
  log.mockRestore();
});

test("a state can be exchanged only once", async () => {
  const api = createTestApi();
  const client = api.client();
  const { state } = await client.auth.start.mutate({ redirectUri });
  const first = await client.auth.exchange.mutate({
    state,
    code: "c",
    device,
  });
  expect(first.token).toBeTruthy();
  await expect(
    client.auth.exchange.mutate({ state, code: "c", device }),
  ).rejects.toMatchObject({
    message: EXPIRED,
    data: { code: "BAD_REQUEST" },
  });
});

test("an attempt older than 10 minutes is refused", async () => {
  const api = createTestApi();
  const client = api.client();
  const { state } = await client.auth.start.mutate({ redirectUri });
  api.clock.advance(600_001);
  await expect(
    client.auth.exchange.mutate({ state, code: "c", device }),
  ).rejects.toMatchObject({
    message: EXPIRED,
    data: { code: "BAD_REQUEST" },
  });
});

test("allowed email matches case-insensitively; others and unverified are FORBIDDEN", async () => {
  const api = createTestApi({ allowedEmail: "arek@example.com" });
  const attempt = async () => {
    const client = api.client();
    const { state } = await client.auth.start.mutate({ redirectUri });
    return client.auth.exchange.mutate({ state, code: "c", device });
  };

  api.google.identity = { email: " Arek@Example.COM ", emailVerified: true };
  expect((await attempt()).token).toBeTruthy();

  api.google.identity = { email: "someone@else.com", emailVerified: true };
  await expect(attempt()).rejects.toMatchObject({
    message: NOT_ALLOWED,
    data: { code: "FORBIDDEN" },
  });

  api.google.identity = { email: "arek@example.com", emailVerified: false };
  await expect(attempt()).rejects.toMatchObject({
    message: NOT_ALLOWED,
    data: { code: "FORBIDDEN" },
  });
});

test("devSignIn only exists in development", async () => {
  await expect(
    createTestApi({ devAuth: false })
      .client()
      .auth.devSignIn.mutate({ device }),
  ).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  expect(
    (
      await createTestApi({ devAuth: true }).client().auth.devSignIn.mutate({
        device,
      })
    ).token,
  ).toBeTruthy();
});

test("no or bad bearer token → UNAUTHORIZED", async () => {
  const api = createTestApi();
  await expect(api.client().auth.me.query()).rejects.toMatchObject({
    data: { code: "UNAUTHORIZED" },
  });
  await expect(api.client("garbage").auth.me.query()).rejects.toMatchObject({
    data: { code: "UNAUTHORIZED" },
  });
});

test("signOut revokes only the current session", async () => {
  const api = createTestApi();
  const a = await api.signIn(device);
  const b = await api.signIn({ name: "PC", platform: "windows" });
  expect(await api.client(a).auth.signOut.mutate()).toEqual({ ok: true });
  await expect(api.client(a).auth.me.query()).rejects.toMatchObject({
    data: { code: "UNAUTHORIZED" },
  });
  expect(await api.client(b).auth.me.query()).toMatchObject({
    email: "arek@example.com",
  });
});

test("CORS allows the Tauri origins", async () => {
  const api = createTestApi();
  const preflight = (origin: string) =>
    api.app.request("/trpc/auth.me", {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": "GET",
        "Access-Control-Request-Headers": "authorization",
      },
    });
  const ok = await preflight("tauri://localhost");
  expect(ok.headers.get("Access-Control-Allow-Origin")).toBe(
    "tauri://localhost",
  );
  const bad = await preflight("https://evil.test");
  expect(bad.headers.get("Access-Control-Allow-Origin")).toBeNull();
});

test("GET /health", async () => {
  const res = await createTestApi().app.request("/health");
  expect(await res.json()).toEqual({ ok: true });
});
