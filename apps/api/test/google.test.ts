import { UnsecuredJWT } from "jose";
import { createGoogleOAuth } from "../src/auth/google";

const cfg = { clientId: "cid", clientSecret: "sec" };
const redirectUri = "http://127.0.0.1:5000/callback";
const future = () => Math.floor(Date.now() / 1000) + 3600;

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const impl: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify(body), { status });
  };
  return { impl, calls };
}

const idToken = (claims: Record<string, unknown>) =>
  new UnsecuredJWT(claims).encode();

const goodClaims = () => ({
  iss: "https://accounts.google.com",
  aud: "cid",
  email: "a@b.c",
  email_verified: true,
  exp: future(),
});

const exchangeArgs = { code: "the-code", codeVerifier: "ver", redirectUri };

test("authUrl carries PKCE, loopback redirect and only openid email", () => {
  const u = new URL(
    createGoogleOAuth(cfg).authUrl({
      state: "s",
      codeChallenge: "c",
      redirectUri,
    }),
  );
  expect(u.origin + u.pathname).toBe(
    "https://accounts.google.com/o/oauth2/v2/auth",
  );
  expect(Object.fromEntries(u.searchParams)).toEqual({
    client_id: "cid",
    scope: "openid email",
    code_challenge_method: "S256",
    code_challenge: "c",
    state: "s",
    redirect_uri: redirectUri,
    response_type: "code",
    prompt: "select_account",
  });
});

test("exchange posts the verifier and secret and returns email claims", async () => {
  const f = fakeFetch(200, { id_token: idToken(goodClaims()) });
  const result = await createGoogleOAuth(cfg, f.impl).exchange(exchangeArgs);
  expect(result).toEqual({ email: "a@b.c", emailVerified: true });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]?.url).toBe("https://oauth2.googleapis.com/token");
  expect(f.calls[0]?.init?.method).toBe("POST");
  expect(
    Object.fromEntries(new URLSearchParams(String(f.calls[0]?.init?.body))),
  ).toEqual({
    code: "the-code",
    code_verifier: "ver",
    redirect_uri: redirectUri,
    client_id: "cid",
    client_secret: "sec",
    grant_type: "authorization_code",
  });
});

test("exchange reports an unverified email faithfully", async () => {
  const f = fakeFetch(200, {
    id_token: idToken({ ...goodClaims(), email_verified: false }),
  });
  expect(await createGoogleOAuth(cfg, f.impl).exchange(exchangeArgs)).toEqual({
    email: "a@b.c",
    emailVerified: false,
  });
});

test("exchange accepts the bare accounts.google.com issuer", async () => {
  const f = fakeFetch(200, {
    id_token: idToken({ ...goodClaims(), iss: "accounts.google.com" }),
  });
  await expect(
    createGoogleOAuth(cfg, f.impl).exchange(exchangeArgs),
  ).resolves.toMatchObject({ email: "a@b.c" });
});

test.each([
  ["another client", { aud: "other" }],
  ["another issuer", { iss: "https://evil.test" }],
  ["an expired token", { exp: Math.floor(Date.now() / 1000) - 10 }],
  ["no email", { email: undefined }],
])("exchange rejects %s", async (_name, override) => {
  const f = fakeFetch(200, {
    id_token: idToken({ ...goodClaims(), ...override }),
  });
  await expect(
    createGoogleOAuth(cfg, f.impl).exchange(exchangeArgs),
  ).rejects.toThrow();
});

test("exchange rejects a response without an id_token", async () => {
  const f = fakeFetch(200, {});
  await expect(
    createGoogleOAuth(cfg, f.impl).exchange(exchangeArgs),
  ).rejects.toThrow();
});

test("exchange surfaces Google's error without the secret", async () => {
  const f = fakeFetch(400, { error: "invalid_grant" });
  const err = await createGoogleOAuth(cfg, f.impl)
    .exchange(exchangeArgs)
    .catch((e: Error) => e);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toMatch(/invalid_grant/);
  expect((err as Error).message).not.toContain("sec");
});
