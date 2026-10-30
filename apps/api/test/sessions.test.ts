import { SESSION_DAYS } from "@dlh/api-contract";
import { memoryAuthStore } from "../src/auth/memoryStore";
import { authenticate, sessionExpiry } from "../src/auth/sessions";
import { hashToken } from "../src/auth/tokens";

const day = 86_400_000;
const minute = 60_000;
const t0 = new Date("2026-10-30T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

async function setup() {
  const store = memoryAuthStore();
  const token = "tok";
  const row = await store.createSession(
    {
      tokenHash: hashToken(token),
      email: "a@b.c",
      deviceName: "Mac",
      platform: "macos",
      lastUsedAt: t0,
      expiresAt: sessionExpiry(t0),
    },
    t0,
  );
  return { store, token, row };
}

test("sessionExpiry is 90 days out", () => {
  expect(sessionExpiry(t0).getTime()).toBe(t0.getTime() + SESSION_DAYS * day);
});

test("renews when used after an hour, not before", async () => {
  const { store, token, row } = await setup();
  const early = await authenticate(store, token, at(30 * minute));
  expect(early?.expiresAt).toEqual(row.expiresAt);
  const late = await authenticate(store, token, at(61 * minute));
  expect(late).not.toBeNull();
  const found = await store.findSessionByTokenHash(hashToken(token));
  expect(found?.expiresAt).toEqual(at(61 * minute + 90 * day));
  expect(found?.lastUsedAt).toEqual(at(61 * minute));
});

test("89 days after last renewal is accepted and extended; 90 days is refused", async () => {
  const { store, token } = await setup();
  const row = await authenticate(store, token, at(89 * day));
  expect(row).not.toBeNull();
  const found = await store.findSessionByTokenHash(hashToken(token));
  expect(found?.expiresAt).toEqual(at(179 * day));

  const fresh = await setup();
  expect(await authenticate(fresh.store, fresh.token, at(90 * day))).toBeNull();
});

test("revoked token is refused immediately, inside the throttle window", async () => {
  const { store, token, row } = await setup();
  expect(await authenticate(store, token, at(minute))).not.toBeNull();
  await store.revokeSession(row.id, at(minute));
  expect(await authenticate(store, token, at(2 * minute))).toBeNull();
});

test("unknown token → null", async () =>
  expect(await authenticate(memoryAuthStore(), "nope", t0)).toBeNull());
