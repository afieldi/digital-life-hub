import {
  codeChallengeS256,
  hashToken,
  newCodeVerifier,
  newSessionToken,
  newState,
} from "../src/auth/tokens";

test("hash is stable and not the token", () => {
  const t = newSessionToken();
  expect(hashToken(t)).toBe(hashToken(t));
  expect(hashToken(t)).not.toContain(t);
  expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
});

test("S256 challenge matches RFC 7636 appendix B", () =>
  expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe(
    "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM",
  ));

test("random values are url-safe, distinct and the right length", () => {
  expect(newSessionToken()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(newCodeVerifier()).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(newState()).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(newSessionToken()).not.toBe(newSessionToken());
});
