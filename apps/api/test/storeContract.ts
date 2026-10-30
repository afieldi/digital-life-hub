import type { AuthStore, LoginAttempt } from "../src/auth/store";

const minute = 60_000;
const t0 = new Date("2026-10-30T12:00:00Z");
const at = (ms: number) => new Date(t0.getTime() + ms);

const attempt = (state: string, expiresAt: Date): LoginAttempt => ({
  state,
  codeVerifier: `verifier-${state}`,
  redirectUri: "http://127.0.0.1:5555/callback",
  expiresAt,
});

const session = (tokenHash: string, lastUsedAt: Date, expiresAt: Date) => ({
  tokenHash,
  email: "a@b.c",
  deviceName: "Mac",
  platform: "macos" as const,
  lastUsedAt,
  expiresAt,
});

export function describeAuthStore(
  name: string,
  make: () => Promise<{ store: AuthStore; done: () => Promise<void> }>,
) {
  describe(`AuthStore: ${name}`, () => {
    async function withStore(fn: (store: AuthStore) => Promise<void>) {
      const { store, done } = await make();
      try {
        await fn(store);
      } finally {
        await done();
      }
    }

    test("a login attempt is single-use", () =>
      withStore(async (store) => {
        const a = attempt("s1", at(10 * minute));
        await store.putLoginAttempt(a, t0);
        expect(await store.takeLoginAttempt("s1", at(minute))).toEqual(a);
        expect(await store.takeLoginAttempt("s1", at(minute))).toBeNull();
      }));

    test("an expired attempt returns null", () =>
      withStore(async (store) => {
        await store.putLoginAttempt(attempt("s2", at(10 * minute)), t0);
        expect(await store.takeLoginAttempt("s2", at(10 * minute))).toBeNull();
        expect(await store.takeLoginAttempt("missing", t0)).toBeNull();
      }));

    test("putLoginAttempt purges expired attempts", () =>
      withStore(async (store) => {
        await store.putLoginAttempt(attempt("old", at(10 * minute)), t0);
        await store.putLoginAttempt(
          attempt("new", at(40 * minute)),
          at(30 * minute),
        );
        // "old" is gone even when asked about with a clock before its expiry
        expect(await store.takeLoginAttempt("old", t0)).toBeNull();
        expect(
          await store.takeLoginAttempt("new", at(31 * minute)),
        ).not.toBeNull();
      }));

    test("createSession fills id, createdAt and revokedAt", () =>
      withStore(async (store) => {
        const row = await store.createSession(
          session("h1", t0, at(minute)),
          t0,
        );
        expect(row.id).toBeTruthy();
        expect(row.createdAt).toEqual(t0);
        expect(row.revokedAt).toBeNull();
        expect(await store.findSessionByTokenHash("h1")).toEqual(row);
        expect(await store.findSessionByTokenHash("nope")).toBeNull();
      }));

    test("touchSession updates lastUsedAt and expiresAt", () =>
      withStore(async (store) => {
        const row = await store.createSession(
          session("h2", t0, at(minute)),
          t0,
        );
        await store.touchSession(row.id, at(5 * minute), at(50 * minute));
        const found = await store.findSessionByTokenHash("h2");
        expect(found?.lastUsedAt).toEqual(at(5 * minute));
        expect(found?.expiresAt).toEqual(at(50 * minute));
      }));

    test("listActiveSessions hides revoked and expired sessions and orders by lastUsedAt desc", () =>
      withStore(async (store) => {
        const now = at(30 * minute);
        const older = await store.createSession(
          session("a", at(minute), at(60 * minute)),
          t0,
        );
        const newer = await store.createSession(
          session("b", at(20 * minute), at(60 * minute)),
          t0,
        );
        await store.createSession(session("expired", at(2 * minute), now), t0);
        const revoked = await store.createSession(
          session("revoked", at(25 * minute), at(60 * minute)),
          t0,
        );
        await store.revokeSession(revoked.id, now);
        const list = await store.listActiveSessions(now);
        expect(list.map((s) => s.id)).toEqual([newer.id, older.id]);
      }));

    test("revokeSession returns false the second time", () =>
      withStore(async (store) => {
        const row = await store.createSession(
          session("r", t0, at(60 * minute)),
          t0,
        );
        expect(await store.revokeSession(row.id, at(minute))).toBe(true);
        expect(await store.revokeSession(row.id, at(2 * minute))).toBe(false);
        expect(
          await store.revokeSession(
            "00000000-0000-4000-8000-000000000000",
            at(minute),
          ),
        ).toBe(false);
      }));

    test("findSessionByTokenHash returns the revoked row", () =>
      withStore(async (store) => {
        const row = await store.createSession(
          session("rv", t0, at(60 * minute)),
          t0,
        );
        await store.revokeSession(row.id, at(minute));
        const found = await store.findSessionByTokenHash("rv");
        expect(found?.id).toBe(row.id);
        expect(found?.revokedAt).toEqual(at(minute));
      }));
  });
}
