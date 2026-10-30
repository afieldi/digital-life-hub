# Server + Sign-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `pnpm dev` brings up Postgres, the API and the Tauri app; you sign in with Google (one allowed email), quit and reopen without signing in again, and revoking that session from Settings → Devices (or `pnpm --filter @dlh/api sessions revoke`) signs the app out.

**Architecture:** A new `apps/api` (Node + Hono + tRPC v11) owns sessions and Google OAuth; the desktop app is a typed tRPC client (TanStack Query). Persistence goes through an `AuthStore` interface with an in-memory implementation (unit tests, desktop tests) and a Drizzle/Postgres one (`packages/db`), and both pass one shared contract suite. The Tauri side adds two small Rust modules: a one-shot loopback listener for the OAuth redirect and an OS-keychain token store.

**Tech Stack:** Hono + `@hono/node-server` + `@hono/trpc-server`, tRPC v11 (`@trpc/server`, `@trpc/client`, `@trpc/tanstack-react-query`), TanStack Query v5, Zod v4, Drizzle ORM + drizzle-kit + `postgres` (postgres.js), Postgres 18 in Docker Compose, `jose` (ID token claims), Rust `keyring` v3 + `url`, `tauri-plugin-opener`, `tauri-plugin-os`, Vitest, Playwright.

**Spec:** Core + Shell — Deep-dive Spec, https://claude.ai/artifact/3iKKdVquEJ4Vd3EcA8DUZS (sections: Architecture, Stack and repo layout, Build and run, API and auth → Sign-in, Milestones → 2. Server and sign-in). Builds on `docs/superpowers/plans/2026-10-30-skeleton-and-ui-library.md`.

**Decisions made after the spec (2026-10-30):**
- Google sign-in only. The spec's server-printed emergency one-time code is **dropped**.
- Shared Zod schemas live in a new `packages/api-contract`. The `AppRouter` *type* is exported from `@dlh/api/router` and imported type-only by the desktop app. Re-exporting it from `api-contract` would make the two packages depend on each other, and Turbo rejects that cycle.
- Browser mode (`dev:web`, Playwright) signs in through a dev-only `auth.devSignIn`, which exists only when `NODE_ENV=development`.
- `pnpm build` bundles the API (`dist/`) but does not build its Docker image. That's `pnpm --filter @dlh/api docker:build`, so `pnpm build` keeps working on Windows CI runners without Docker. The image is built in the Linux CI job.
- The Google OAuth client ("Desktop app" type) already exists. Its credentials go in a gitignored `apps/api/.env`, and `apps/api/.env.example` is committed. Never paste them into chat, code or tests.

**Not in this plan:** items, links, recents, search, `/changes`, seeding (milestone 3; the `pnpm dev` seed step arrives with the first item-owning module); AI gateway (milestone 4); hosting/deploy; code signing.

## Global Constraints

- Scopes: `openid email` only. One allowed email from server config. Compare emails trimmed and lowercased. Reject `email_verified: false`.
- Sessions last 90 days and renew with use. Store only a SHA-256 hash of the token, never the token itself.
- Token in the OS keychain (macOS Keychain, Windows Credential Manager) via `keyring`: service `app.digitallifehub.desktop`, account `session-token`. Browser mode only: `localStorage` key `dlh.devSessionToken`.
- The OAuth redirect goes to a one-time loopback port: `http://127.0.0.1:<port>/callback`. Never `localhost`, never a custom `dlh://` scheme. PKCE (S256) and `state` on every attempt. An attempt expires after 10 minutes, and the listener gives up after 5 minutes.
- The app never calls Google's token endpoint. The server does, so the client secret stays on the server.
- API on `http://127.0.0.1:8787` (desktop reads `VITE_API_URL`, default that). tRPC mounted at `/trpc`, health at `GET /health` → `{ ok: true }`.
- CORS allow-list: `http://localhost:1420`, `tauri://localhost`, `http://tauri.localhost`.
- Postgres 18 image `postgres:18`, compose service `db`, user/password/db `dlh`/`dlh`/`dlh`, **host port 54329** (5432 is often taken by a Homebrew Postgres). Mount the volume at `/var/lib/postgresql`, not `/var/lib/postgresql/data`, because the 18 image moved PGDATA. Test database `dlh_test`, created on demand by the test helper.
- IDs: `uuid` primary keys defaulting to Postgres 18's built-in `uuidv7()`.
- Dates cross the wire as ISO-8601 strings. No superjson.
- Package names: `@dlh/db`, `@dlh/api-contract`, `@dlh/api`. All are TypeScript-source packages (`exports` point at `src/*.ts`) like `@dlh/core`.
- DB-backed tests run under a separate `test:db` script, so `pnpm test` stays green with no Docker. CI runs `test:db` on an `ubuntu-latest` job with a Postgres service.
- Everything from the milestone 1 plan's Global Constraints still holds: strict TS, Biome, latest stable deps at install time, macOS and Windows.

## Review Focus

1. **Server unreachable or offline at launch:** a stored token must not be thrown away because a request failed on the network. Only an `UNAUTHORIZED` response signs out. Test in Task 7.
2. **The user abandons or cancels Google consent** (`?error=access_denied`, closes the tab, or clicks Sign in twice): the attempt ends with a clear message, the button works again, and a second click replaces the first listener rather than hanging. Tests in Tasks 6 and 7.
3. **Allowed-email edge cases:** `" Arek@Example.com "` against config `arek@example.com` is accepted; an unverified email or any other account gets `FORBIDDEN`. Tests in Tasks 3 and 4.
4. **Revocation and expiry are never cached:** a revoked token is refused on the very next request, even inside the 1-hour renew-throttle window. A token last renewed exactly 90 days ago is refused, and one renewed 89 days ago is accepted and extended. Test in Task 3.
5. **Hostile `redirectUri` or replayed `state`:** `auth.start` refuses anything but `http://127.0.0.1:<1–65535>/callback`, and `auth.exchange` refuses a state that is unknown, expired or already used. Tests in Task 4.

---

## File structure

```
digital-life-hub/
  docker-compose.yml                 Postgres 18 only
  package.json                       + dev:down, db:reset, test:db
  turbo.json                         + test:db (uncached)
  scripts/dev.ts (+ .test.ts)        docker → migrate → api + desktop
  .github/workflows/ci.yml           + ubuntu "server" job
  packages/
    db/
      package.json  drizzle.config.ts  vitest.config.ts
      drizzle/                       generated SQL migrations (committed)
      src/ index.ts  schema.ts  client.ts  migrate.ts  reset.ts  testing.ts
      test/ migrate.db.test.ts
    api-contract/
      package.json
      src/ index.ts  auth.ts
      test/ auth.test.ts
  apps/
    api/
      package.json  tsconfig.json  vitest.config.ts  Dockerfile  .env.example
      src/
        config.ts                    loadConfig(env)
        auth/ tokens.ts  store.ts  memoryStore.ts  drizzleStore.ts  sessions.ts  google.ts
        trpc.ts  router.ts  routers/auth.ts  routers/devices.ts
        app.ts                       createApp(deps) → Hono
        main.ts                      node entry
        testing.ts                   createTestApi() for api + desktop tests
        cli/sessions.ts              list | revoke <id> | revoke --all
      test/ config.test.ts tokens.test.ts sessions.test.ts storeContract.ts
            memoryStore.test.ts drizzleStore.db.test.ts auth.test.ts devices.test.ts google.test.ts
    desktop/
      src/ api/client.ts
           auth/ tokenStore.ts  signIn.ts  AuthProvider.tsx  SignIn.tsx
           routes/settings/Devices.tsx  routes/settings/lastActive.ts
           App.tsx  main.tsx  (modified)
      src-tauri/src/ lib.rs (modified)  loopback.rs  token.rs
      src-tauri/capabilities/default.json (modified)
      test/ apiHarness.ts  auth.test.tsx  devices.test.tsx  lastActive.test.ts  Shell.test.tsx (modified)
      e2e/ signIn.ts (helper)  auth.spec.ts  shell.spec.ts (modified)
```

---

### Task 1: Postgres in Compose and `packages/db`

**Files:**
- Create: `docker-compose.yml`, `packages/db/{package.json,drizzle.config.ts,vitest.config.ts,tsconfig.json}`, `packages/db/src/{index,schema,client,migrate,reset,testing}.ts`, `packages/db/drizzle/*` (generated)
- Modify: `turbo.json` (add `"test:db": { "dependsOn": ["^build"], "cache": false }`), root `package.json` (add `"test:db": "turbo run test:db"`, `"dev:down": "docker compose down"`, `"db:reset": "pnpm --filter @dlh/db reset"`)
- Test: `packages/db/test/migrate.db.test.ts`

**Interfaces:**
- Produces (`@dlh/db`):
  - `sessions` table: `id uuid pk default uuidv7()`, `token_hash text not null unique`, `email text not null`, `device_name text not null`, `platform text not null`, `created_at timestamptz not null default now()`, `last_used_at timestamptz not null`, `expires_at timestamptz not null`, `revoked_at timestamptz`.
  - `login_attempts` table: `state text pk`, `code_verifier text not null`, `redirect_uri text not null`, `expires_at timestamptz not null`.
  - `DEFAULT_DATABASE_URL = "postgres://dlh:dlh@127.0.0.1:54329/dlh"`, `DEFAULT_TEST_DATABASE_URL = "postgres://dlh:dlh@127.0.0.1:54329/dlh_test"`
  - `type Db` (Drizzle postgres-js database with the schema), `createDb(url: string): { db: Db; close: () => Promise<void> }`
  - `migrate(url: string, migrationsFolder?: string): Promise<void>` (Drizzle migrator; folder defaults to this package's `drizzle/`)
  - `freshTestDb(): Promise<{ db: Db; url: string; close: () => Promise<void> }>`: connects to `TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL`, creates the database through the `dlh` admin database if it's missing, drops and recreates schemas `public` and `drizzle`, then migrates.
  - Package scripts: `generate` (`drizzle-kit generate`), `migrate` (`tsx src/migrate.ts`, URL from `DATABASE_URL ?? DEFAULT_DATABASE_URL`), `reset` (`tsx src/reset.ts`: drop + recreate both schemas, migrate), `test` (`vitest run --passWithNoTests --exclude '**/*.db.test.ts'`), `test:db` (`vitest run '.db.test.ts'` with `fileParallelism: false`), `typecheck`.

- [ ] **Step 1: Compose file.** Service `db`, image `postgres:18`, env `POSTGRES_USER/PASSWORD/DB = dlh`, ports `54329:5432`, named volume `dlh-pg` at `/var/lib/postgresql`, healthcheck `pg_isready -U dlh -d dlh` (interval 2s, retries 30), so that `docker compose up -d --wait` returns once Postgres is ready. Run `docker compose up -d --wait`. Expected: exit 0, `docker compose ps` shows `db` healthy.

- [ ] **Step 2: Write the failing test**

```ts
// packages/db/test/migrate.db.test.ts
import { sql } from "drizzle-orm";
import { freshTestDb, sessions } from "../src";

test("migrations create sessions with uuidv7 ids", async () => {
  const { db, close } = await freshTestDb();
  const [row] = await db.insert(sessions).values({
    tokenHash: "h", email: "a@example.com", deviceName: "Mac", platform: "macos",
    lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 1000),
  }).returning();
  expect(row.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7/);
  const tables = await db.execute(sql`select table_name from information_schema.tables where table_schema = 'public' order by 1`);
  expect(tables.map((t) => t.table_name)).toEqual(["login_attempts", "sessions"]);
  await close();
});

test("freshTestDb starts empty every time", async () => {
  const a = await freshTestDb();
  await a.db.insert(sessions).values({ tokenHash: "x", email: "e", deviceName: "d", platform: "web", lastUsedAt: new Date(), expiresAt: new Date() });
  await a.close();
  const b = await freshTestDb();
  expect(await b.db.select().from(sessions)).toEqual([]);
  await b.close();
});
```

- [ ] **Step 3: Run to verify it fails.** `pnpm --filter @dlh/db test:db` → FAIL, cannot resolve `../src`.
- [ ] **Step 4: Implement** the schema (Drizzle `pgTable`, camelCase TS names mapped to the snake_case columns above, `.default(sql\`uuidv7()\`)`), then `pnpm --filter @dlh/db generate` and commit the generated SQL, then `client.ts`, `migrate.ts`, `reset.ts`, `testing.ts`.
- [ ] **Step 5: Run to verify it passes.** `pnpm --filter @dlh/db test:db` → 2 passed. `pnpm db:reset` → exit 0.
- [ ] **Step 6: Commit** — `feat(db): Postgres 18 compose service, sessions schema and migrations`.

---

### Task 2: `packages/api-contract`

**Files:**
- Create: `packages/api-contract/{package.json,tsconfig.json}`, `packages/api-contract/src/{index,auth}.ts`
- Test: `packages/api-contract/test/auth.test.ts`

**Interfaces:**
- Produces (`@dlh/api-contract`, depends only on `zod`):
  - `SESSION_DAYS = 90`, `SESSION_RENEW_AFTER_MS = 3_600_000`, `LOGIN_ATTEMPT_MS = 600_000`
  - `loopbackRedirectUri`: `z.string()` that accepts only `http://127.0.0.1:<1–65535>/callback`
  - `platform = z.enum(["macos", "windows", "web"])`, `deviceInput = z.object({ name: z.string().trim().min(1).max(100), platform })`
  - `startInput = z.object({ redirectUri: loopbackRedirectUri })`, `startOutput = z.object({ authUrl: z.url(), state: z.string() })`
  - `exchangeInput = z.object({ state: z.string().min(1), code: z.string().min(1), device: deviceInput })`
  - `signInOutput = z.object({ token: z.string() })`
  - `meOutput = z.object({ email: z.string(), sessionId: z.uuid() })`
  - `deviceSession = z.object({ id: z.uuid(), name: z.string(), platform, createdAt: z.iso.datetime(), lastUsedAt: z.iso.datetime(), current: z.boolean() })`
  - `revokeInput = z.object({ id: z.uuid() })`
  - inferred types: `DeviceInput`, `DeviceSession`, `Platform`

- [ ] **Step 1: Write the failing test**

```ts
import { deviceInput, loopbackRedirectUri } from "../src";

test.each([
  ["http://127.0.0.1:53682/callback", true], ["http://127.0.0.1:1/callback", true],
  ["http://localhost:53682/callback", false], ["https://127.0.0.1:53682/callback", false],
  ["http://127.0.0.1:53682/callback?x=1", false], ["http://127.0.0.1:0/callback", false],
  ["http://127.0.0.1:65536/callback", false], ["http://127.0.0.1.evil.com:80/callback", false],
  ["http://127.0.0.1:80/other", false],
])("redirect %s → %s", (uri, ok) => expect(loopbackRedirectUri.safeParse(uri).success).toBe(ok));

test("device name is trimmed and required", () => {
  expect(deviceInput.parse({ name: "  Arek's Mac ", platform: "macos" }).name).toBe("Arek's Mac");
  expect(deviceInput.safeParse({ name: "   ", platform: "macos" }).success).toBe(false);
  expect(deviceInput.safeParse({ name: "PC", platform: "linux" }).success).toBe(false);
});
```

- [ ] **Step 2–4:** fail, implement, pass (`pnpm --filter @dlh/api-contract test`).
- [ ] **Step 5: Commit** — `feat(api-contract): auth and device schemas`.

---

### Task 3: API foundations — config, tokens, AuthStore, session rules

**Files:**
- Create: `apps/api/{package.json,tsconfig.json,vitest.config.ts,.env.example}`, `apps/api/src/config.ts`, `apps/api/src/auth/{tokens,store,memoryStore,sessions}.ts`
- Modify: `.gitignore` (add `.env`)
- Test: `apps/api/test/{config,tokens,sessions,memoryStore}.test.ts`, `apps/api/test/storeContract.ts`

**Interfaces:**
- Consumes: constants from Task 2.
- Produces:
  - `type Config = { port: number; databaseUrl: string; google: { clientId: string; clientSecret: string }; allowedEmail: string; devAuth: boolean }`
  - `class ConfigError extends Error { missing: string[] }`; `loadConfig(env: Record<string, string | undefined>): Config` reads `PORT` (default 8787), `DATABASE_URL` (default `DEFAULT_DATABASE_URL`), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `ALLOWED_EMAIL` (required; stored trimmed and lowercased; must be an email). `devAuth = env.NODE_ENV === "development"`.
  - `.env.example` lists every variable above, with empty Google values and the comment `# Google Cloud → Credentials → OAuth client (Desktop app)`.
  - `tokens.ts`: `newSessionToken(): string` (32 random bytes, base64url), `hashToken(token: string): string` (SHA-256 hex), `newState(): string` (16 bytes base64url), `newCodeVerifier(): string` (32 bytes base64url), `codeChallengeS256(verifier: string): string`
  - `store.ts`:

```ts
export type SessionRow = { id: string; tokenHash: string; email: string; deviceName: string; platform: Platform;
  createdAt: Date; lastUsedAt: Date; expiresAt: Date; revokedAt: Date | null };
export type LoginAttempt = { state: string; codeVerifier: string; redirectUri: string; expiresAt: Date };
export interface AuthStore {
  putLoginAttempt(a: LoginAttempt, now: Date): Promise<void>;      // also deletes attempts expired at `now`
  takeLoginAttempt(state: string, now: Date): Promise<LoginAttempt | null>; // single use; null if missing or expired
  createSession(s: Omit<SessionRow, "id" | "createdAt" | "revokedAt">, now: Date): Promise<SessionRow>;
  findSessionByTokenHash(hash: string): Promise<SessionRow | null>;
  touchSession(id: string, lastUsedAt: Date, expiresAt: Date): Promise<void>;
  listActiveSessions(now: Date): Promise<SessionRow[]>;            // not revoked, expiresAt > now, lastUsedAt desc
  revokeSession(id: string, now: Date): Promise<boolean>;          // false if missing or already revoked
}
```

  - `memoryAuthStore(): AuthStore` (ids from `crypto.randomUUID()`)
  - `sessions.ts`: `authenticate(store: AuthStore, token: string, now: Date): Promise<SessionRow | null>`. Returns null when the row is missing, revoked, or `expiresAt <= now`. When `now - lastUsedAt >= SESSION_RENEW_AFTER_MS`, it calls `touchSession(id, now, now + SESSION_DAYS)`. `sessionExpiry(now: Date): Date`.
  - `test/storeContract.ts`: `describeAuthStore(name: string, make: () => Promise<{ store: AuthStore; done: () => Promise<void> }>)`, which Task 5 reuses for the Drizzle store.
  - Package scripts: `test` (`vitest run --exclude '**/*.db.test.ts'`), `test:db`, `typecheck`.

- [ ] **Step 1: Write the failing tests**

```ts
// config.test.ts
const base = { GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "s", ALLOWED_EMAIL: " Arek@Example.com " };
test("normalises the allowed email and defaults port and devAuth", () => {
  const c = loadConfig(base);
  expect(c).toMatchObject({ port: 8787, allowedEmail: "arek@example.com", devAuth: false });
  expect(loadConfig({ ...base, NODE_ENV: "development" }).devAuth).toBe(true);
});
test("lists every missing variable", () => {
  try { loadConfig({}); expect.unreachable(); }
  catch (e) { expect((e as ConfigError).missing).toEqual(["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "ALLOWED_EMAIL"]); }
});

// tokens.test.ts
test("hash is stable and not the token", () => { const t = newSessionToken(); expect(hashToken(t)).toBe(hashToken(t)); expect(hashToken(t)).not.toContain(t); });
test("S256 challenge matches RFC 7636 appendix B", () =>
  expect(codeChallengeS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"));

// sessions.test.ts — clock helpers: const day = 86_400_000; const t0 = new Date("2026-10-30T12:00:00Z")
test("renews when used after an hour, not before", async () => { /* create at t0; authenticate at t0+30min → expiresAt unchanged; at t0+61min → expiresAt = t0+61min+90d */ });
test("89 days after last renewal is accepted and extended; 90 days is refused", async () => { /* lastUsedAt t0, expiresAt t0+90d; authenticate at t0+89d → row, expiresAt t0+179d; fresh session, authenticate at t0+90d → null */ });
test("revoked token is refused immediately, inside the throttle window", async () => { /* authenticate at t0+1min ok; revokeSession; authenticate at t0+2min → null */ });
test("unknown token → null", async () => expect(await authenticate(memoryAuthStore(), "nope", t0)).toBeNull());

// memoryStore.test.ts
describeAuthStore("memory", async () => ({ store: memoryAuthStore(), done: async () => {} }));
```

`describeAuthStore` cases: a login attempt is single-use; an expired attempt returns null; `putLoginAttempt` purges expired attempts; `listActiveSessions` hides revoked and expired sessions and orders by `lastUsedAt` desc; `revokeSession` returns false the second time; `findSessionByTokenHash` returns the revoked row (`authenticate` decides).

- [ ] **Step 2–4:** fail, implement, pass (`pnpm --filter @dlh/api test`).
- [ ] **Step 5: Commit** — `feat(api): config, session tokens and AuthStore with sliding 90-day sessions`.

---

### Task 4: tRPC routers and the Hono app

**Files:**
- Create: `apps/api/src/{trpc,router,app,testing}.ts`, `apps/api/src/routers/{auth,devices}.ts`, `apps/api/src/auth/google.ts` (interface only in this task)
- Test: `apps/api/test/{auth,devices}.test.ts`

**Interfaces:**
- Consumes: Tasks 2–3.
- Produces:
  - `google.ts`: `interface GoogleOAuth { authUrl(p: { state: string; codeChallenge: string; redirectUri: string }): string; exchange(p: { code: string; codeVerifier: string; redirectUri: string }): Promise<{ email: string; emailVerified: boolean }> }`
  - `type AppDeps = { config: Config; store: AuthStore; google: GoogleOAuth; now: () => Date }`
  - `trpc.ts`: context `{ deps: AppDeps; session: SessionRow | null }` built from `Authorization: Bearer <token>` via `authenticate`; `publicProcedure`, `protectedProcedure` (throws `UNAUTHORIZED` when `session` is null)
  - `appRouter` with:
    - `auth.start` (public): `startInput → startOutput`. It stores a `LoginAttempt` (`expiresAt = now + LOGIN_ATTEMPT_MS`) and returns `google.authUrl(...)`.
    - `auth.exchange` (public): `exchangeInput → signInOutput`. It takes the attempt (missing/expired → `BAD_REQUEST`, message `"Sign-in expired — try again."`) and calls `google.exchange` with the attempt's verifier and redirectUri. It refuses unverified or non-matching emails (trimmed, lowercased) with `FORBIDDEN`, message `"That Google account isn't allowed to use this hub."`. Otherwise it creates the session and returns the raw token.
    - `auth.devSignIn` (public): `{ device: deviceInput } → signInOutput`. Throws `NOT_FOUND` unless `config.devAuth`. Signs in as `config.allowedEmail`.
    - `auth.me` (protected): `→ meOutput`
    - `auth.signOut` (protected): revokes the current session, `→ { ok: true }`
    - `devices.list` (protected): `→ deviceSession[]`, `current` true for the caller's session
    - `devices.revoke` (protected): `revokeInput → { ok: true }`, `NOT_FOUND` when `revokeSession` returns false
  - `export type AppRouter = typeof appRouter` from `src/router.ts`. Package export `"./router": "./src/router.ts"`.
  - `createApp(deps: AppDeps): Hono`: CORS (Global Constraints list, `Authorization` and `Content-Type` headers), `GET /health`, tRPC at `/trpc/*`
  - `testing.ts` (export `"./testing"`): `createTestApi(opts?: { devAuth?: boolean; allowedEmail?: string }) → { app; store; google: FakeGoogle; clock: { now(): Date; advance(ms: number): void }; fetch: typeof fetch; client(token?: string): TRPCClient<AppRouter>; signIn(device?: DeviceInput): Promise<string> }`. `FakeGoogle.identity` (default `{ email: allowedEmail, emailVerified: true }`) is what `exchange` returns. `authUrl` returns `https://accounts.google.com/o/oauth2/v2/auth?state=<state>`. `signIn` runs start → exchange and returns the token. `client` uses `httpLink` with `fetch: (u, i) => app.fetch(new Request(u, i))`.

- [ ] **Step 1: Write the failing tests**

```ts
// auth.test.ts
const device = { name: "Arek's Mac", platform: "macos" as const };
test("start → exchange issues a token that auth.me accepts", async () => {
  const api = createTestApi();
  const token = await api.signIn(device);
  expect(await api.client(token).auth.me.query()).toMatchObject({ email: "arek@example.com" });
});
test("auth.start rejects non-loopback redirect URIs", async () => {
  const api = createTestApi();
  await expect(api.client().auth.start.mutate({ redirectUri: "http://localhost:5000/callback" })).rejects.toMatchObject({ data: { code: "BAD_REQUEST" } });
});
test("a state can be exchanged only once", async () => { /* start; exchange ok; exchange same state again → BAD_REQUEST "Sign-in expired — try again." */ });
test("an attempt older than 10 minutes is refused", async () => { /* start; clock.advance(600_001); exchange → BAD_REQUEST */ });
test("allowed email matches case-insensitively; others and unverified are FORBIDDEN", async () => {
  /* createTestApi({ allowedEmail: "arek@example.com" }); google.identity = { email: " Arek@Example.COM ", emailVerified: true } → ok;
     { email: "someone@else.com", emailVerified: true } → FORBIDDEN with the exact message; { email: "arek@example.com", emailVerified: false } → FORBIDDEN */
});
test("devSignIn only exists in development", async () => {
  await expect(createTestApi({ devAuth: false }).client().auth.devSignIn.mutate({ device })).rejects.toMatchObject({ data: { code: "NOT_FOUND" } });
  expect((await createTestApi({ devAuth: true }).client().auth.devSignIn.mutate({ device })).token).toBeTruthy();
});
test("no or bad bearer token → UNAUTHORIZED", async () => { /* auth.me with no token, and with "garbage" → UNAUTHORIZED */ });
test("signOut revokes only the current session", async () => { /* two sign-ins; signOut with A; me(A) → UNAUTHORIZED; me(B) ok */ });
test("CORS allows the Tauri origins", async () => { /* OPTIONS /trpc/auth.me with Origin tauri://localhost → Access-Control-Allow-Origin echoes it; Origin https://evil.test → no header */ });

// devices.test.ts
test("lists active sessions and marks the caller", async () => { /* sign in Mac and PC; list with Mac token → 2 rows, Mac current, PC not; ISO date strings */ });
test("revoking another device signs that device out on its next request", async () => { /* Mac revokes PC; PC me → UNAUTHORIZED; Mac list → 1 row */ });
test("revoking an unknown or already-revoked id → NOT_FOUND", async () => { /* … */ });
```

- [ ] **Step 2–4:** fail, implement, pass (`pnpm --filter @dlh/api test`).
- [ ] **Step 5: Commit** — `feat(api): tRPC auth and devices routers on Hono`.

---

### Task 5: Real adapters, entry point, sessions CLI and image

**Files:**
- Create: `apps/api/src/auth/drizzleStore.ts`, `apps/api/src/main.ts`, `apps/api/src/cli/sessions.ts`, `apps/api/Dockerfile`, `.dockerignore`
- Modify: `apps/api/src/auth/google.ts` (add the real implementation), `apps/api/package.json`
- Test: `apps/api/test/google.test.ts`, `apps/api/test/drizzleStore.db.test.ts`

**Interfaces:**
- Consumes: `createDb`, `freshTestDb`, schema (Task 1); `AuthStore`, `describeAuthStore` (Task 3); `createApp` (Task 4).
- Produces:
  - `createGoogleOAuth(cfg: Config["google"], fetchImpl: typeof fetch = fetch): GoogleOAuth`
    - `authUrl` → `https://accounts.google.com/o/oauth2/v2/auth` with `client_id`, `redirect_uri`, `response_type=code`, `scope=openid email`, `state`, `code_challenge`, `code_challenge_method=S256`, `prompt=select_account`.
    - `exchange` POSTs form-encoded `code, code_verifier, redirect_uri, client_id, client_secret, grant_type=authorization_code` to `https://oauth2.googleapis.com/token`. It reads `id_token` with `jose.decodeJwt` and requires `iss ∈ {https://accounts.google.com, accounts.google.com}`, `aud === clientId` and `exp` in the future. The token comes straight from Google over TLS, so the signature check is skipped, as Google's server-flow guidance allows. A non-2xx response throws an error carrying Google's `error` field.
  - `drizzleAuthStore(db: Db): AuthStore` (`takeLoginAttempt` = `DELETE … WHERE state = $1 RETURNING`, then the expiry check)
  - `main.ts`: `loadConfig(process.env)`. On `ConfigError`, it prints `Missing <names> in apps/api/.env — see apps/api/.env.example.` and exits 1. It then runs `select 1` against the DB. On failure it prints `Can't reach Postgres at <host:port> — is Docker running? (pnpm dev starts it.)` and exits 1. When `MIGRATE_ON_START=1` (set only in the Dockerfile) it runs `migrate(config.databaseUrl, "./drizzle")` first. Otherwise it serves `createApp` on `127.0.0.1:<port>` (`0.0.0.0` when `HOST` is set, as the image does) and logs `API listening on http://127.0.0.1:<port>`.
  - `cli/sessions.ts`: `pnpm --filter @dlh/api sessions list` prints `id  device  platform  last used`. `sessions revoke <id>` and `sessions revoke --all` revoke sessions and print the count.
  - Package scripts: `dev` (`tsx watch --env-file-if-exists=.env src/main.ts`, with `NODE_ENV=development` set via `cross-env`), `start` (`node --env-file-if-exists=.env dist/main.js`), `build` (`tsup src/main.ts src/cli/sessions.ts --format esm --out-dir dist`, with `noExternal: [/^@dlh\//]` so the workspace packages are bundled), `sessions` (`tsx --env-file-if-exists=.env src/cli/sessions.ts`), `docker:build` (`docker build -f apps/api/Dockerfile -t dlh-api ../..`).
  - Dockerfile: multi-stage on `node:22-slim`; `pnpm install --frozen-lockfile --filter @dlh/api...`, `pnpm --filter @dlh/api build`, then a runtime stage that copies `dist`, the production deps and `packages/db/drizzle`. Copies `packages/db/drizzle` to `./drizzle`. Sets `MIGRATE_ON_START=1` and `HOST=0.0.0.0`, runs `node dist/main.js` as a non-root user, and exposes 8787.

- [ ] **Step 1: Write the failing tests**

```ts
// google.test.ts — fake fetch records the request and answers with an unsigned JWT built by jose's UnsecuredJWT
test("authUrl carries PKCE, loopback redirect and only openid email", () => {
  const u = new URL(createGoogleOAuth({ clientId: "cid", clientSecret: "sec" }).authUrl({ state: "s", codeChallenge: "c", redirectUri: "http://127.0.0.1:5000/callback" }));
  expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: "cid", scope: "openid email", code_challenge_method: "S256", code_challenge: "c", state: "s", redirect_uri: "http://127.0.0.1:5000/callback", response_type: "code" });
});
test("exchange posts the verifier and secret and returns email claims", async () => { /* assert body fields; claims { iss: "https://accounts.google.com", aud: "cid", email: "a@b.c", email_verified: true, exp: future } → { email: "a@b.c", emailVerified: true } */ });
test("exchange rejects a token for another client or already expired", async () => { /* aud "other" → throws; exp past → throws */ });
test("exchange surfaces Google's error", async () => { /* 400 { error: "invalid_grant" } → rejects /invalid_grant/ */ });

// drizzleStore.db.test.ts
describeAuthStore("drizzle", async () => { const t = await freshTestDb(); return { store: drizzleAuthStore(t.db), done: t.close }; });
```

- [ ] **Step 2–4:** fail, implement, pass: `pnpm --filter @dlh/api test` and `pnpm --filter @dlh/api test:db`.
- [ ] **Step 5: Smoke check.** With `apps/api/.env` filled in and `docker compose up -d --wait` done, run `pnpm --filter @dlh/db migrate && pnpm --filter @dlh/api dev`, then `curl -s http://127.0.0.1:8787/health` → `{"ok":true}`. Then `pnpm --filter @dlh/api docker:build` → the image builds.
- [ ] **Step 6: Commit** — `feat(api): Google OAuth adapter, Postgres store, entry point, sessions CLI and Docker image`.

---

### Task 6: Tauri — loopback listener and keychain token

**Files:**
- Create: `apps/desktop/src-tauri/src/{loopback,token}.rs`
- Modify: `apps/desktop/src-tauri/{Cargo.toml,src/lib.rs,capabilities/default.json}`, `apps/desktop/package.json` (add `@tauri-apps/plugin-opener`, `@tauri-apps/plugin-os`)

**Interfaces:**
- Produces (Tauri commands, invoked from JS):
  - `auth_loopback_start() -> Result<u16, String>`: binds `127.0.0.1:0` and stores the listener in managed state, replacing (and so cancelling) any earlier one.
  - `auth_loopback_wait(expected_state: String) -> Result<String, String>`: takes the stored listener and accepts on a blocking thread (`tauri::async_runtime::spawn_blocking`) for up to 300 s. It answers `GET /callback` and sends 404 to any other path (e.g. `/favicon.ico`) while it keeps waiting. It returns the `code` or one of these errors: `"cancelled"` (listener replaced), `"timeout"`, `"denied"` (`error=access_denied`), `"state_mismatch"`, `"bad_request"`.
  - The browser tab shows HTML with `<title>Digital Life Hub</title>`. On success: "Signed in. You can close this tab and go back to Digital Life Hub." On error: "Sign-in didn't finish. Go back to Digital Life Hub to try again."
  - Pure fn, unit-tested: `parse_callback(request_line: &str, expected_state: &str) -> Callback` where `enum Callback { Code(String), Error(&'static str), NotCallback }`
  - `token_get() -> Result<Option<String>, String>`, `token_set(token: String) -> Result<(), String>`, `token_clear() -> Result<(), String>`: `keyring::Entry::new("app.digitallifehub.desktop", "session-token")`. `NoEntry` maps to `None` / Ok on clear.
  - `Cargo.toml`: `keyring = { version = "3", features = ["apple-native", "windows-native"] }`, `url = "2"`, `tauri-plugin-opener = "2"`, `tauri-plugin-os = "2"`
  - Capabilities: `core:default`, `os:default`, and `opener:allow-open-url` scoped to `https://accounts.google.com/*`

- [ ] **Step 1: Write the failing Rust tests** (in `loopback.rs` `#[cfg(test)]`)

```rust
#[test] fn code_with_matching_state() { assert_eq!(parse_callback("GET /callback?code=abc&state=s1 HTTP/1.1", "s1"), Callback::Code("abc".into())); }
#[test] fn state_mismatch() { assert_eq!(parse_callback("GET /callback?code=abc&state=zz HTTP/1.1", "s1"), Callback::Error("state_mismatch")); }
#[test] fn user_denied() { assert_eq!(parse_callback("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1"), Callback::Error("denied")); }
#[test] fn favicon_is_ignored() { assert_eq!(parse_callback("GET /favicon.ico HTTP/1.1", "s1"), Callback::NotCallback); }
#[test] fn garbage_is_bad_request() { assert_eq!(parse_callback("POST /callback HTTP/1.1", "s1"), Callback::Error("bad_request")); }
#[test] fn listener_round_trip() { /* bind via the same helper the command uses, spawn a thread that writes "GET /favicon.ico" then "GET /callback?code=c&state=s" to the port, assert the wait helper returns Ok("c") */ }
```

- [ ] **Step 2: Run to verify they fail.** `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` → FAIL (unresolved `parse_callback`).
- [ ] **Step 3: Implement.** Keep the accept/wait logic in a plain function `wait_for_code(listener: TcpListener, expected_state: &str, deadline: Instant) -> Result<String, String>` so the round-trip test needs no Tauri runtime. Register both plugins and all five commands in `lib.rs`.
- [ ] **Step 4: Run to verify they pass.** Same command → 6 passed. `pnpm --filter @dlh/desktop exec tauri build --no-bundle` → builds.
- [ ] **Step 5: Commit** — `feat(desktop): loopback OAuth listener and keychain token store`.

---

### Task 7: Desktop — API client, auth state and sign-in screen

**Files:**
- Create: `apps/desktop/src/api/client.ts`, `apps/desktop/src/auth/{tokenStore,signIn}.ts`, `apps/desktop/src/auth/{AuthProvider,SignIn}.tsx`, `apps/desktop/test/apiHarness.ts`
- Modify: `apps/desktop/src/{App,main}.tsx`, `apps/desktop/package.json` (deps `@trpc/client`, `@trpc/tanstack-react-query`, `@tanstack/react-query`, `@dlh/api-contract`; devDep `@dlh/api` `workspace:*`), `apps/desktop/test/Shell.test.tsx`
- Test: `apps/desktop/test/auth.test.tsx`

**Interfaces:**
- Consumes: `AppRouter` from `@dlh/api/router`, type-only and always imported as `import type { AppRouter as ApiRouter } from "@dlh/api/router"`, because the desktop already has its own `AppRouter` (the TanStack router type in `src/router.tsx`). Also: `createTestApi` (`@dlh/api/testing`, tests only), Tauri commands (Task 6).
- Produces:
  - `tokenStore.ts`: `interface TokenStore { get(): Promise<string | null>; set(token: string): Promise<void>; clear(): Promise<void> }`, `tauriTokenStore: TokenStore` (invokes `token_*`), `webTokenStore(storage?: Storage): TokenStore` (key `dlh.devSessionToken`, try/catch like `sceneOverride.ts`), `memoryTokenStore(initial?: string): TokenStore` (tests)
  - `client.ts`: `const { TRPCProvider, useTRPC } = createTRPCContext<ApiRouter>()`; `API_URL = import.meta.env.VITE_API_URL ?? "http://127.0.0.1:8787"`; `createApi(opts: { url?: string; getToken: () => Promise<string | null>; fetch?: typeof fetch }) → { trpcClient: TRPCClient<ApiRouter>; queryClient: QueryClient }` (`httpBatchLink` at `${url}/trpc` with a bearer header); `isUnauthorized(err: unknown): boolean` (`TRPCClientError` with `data.code === "UNAUTHORIZED"`)
  - `signIn.ts`: `type SignInMethod = (client: TRPCClient<ApiRouter>) => Promise<string>` (resolves to the token); `googleSignIn: SignInMethod` (`auth_loopback_start` → `auth.start({ redirectUri: \`http://127.0.0.1:${port}/callback\` })` → `openUrl(authUrl)` → `auth_loopback_wait(state)` → `auth.exchange({ state, code, device })`, device from plugin-os `hostname()` / `platform()`); `devSignIn: SignInMethod` (`auth.devSignIn({ device: { name: "Browser (dev)", platform: "web" } })`); `class SignInError extends Error { reason: "cancelled" | "denied" | "timeout" | "forbidden" | "expired" | "network" }` mapping Rust strings and tRPC codes
  - `AuthProvider.tsx`: `<AuthProvider tokenStore method api sessionCheckMs?={30_000}>`; `useAuth(): { status: "loading" | "signedOut" | "signingIn" | "signedIn"; error: SignInError | null; signIn(): Promise<void>; signOut(): Promise<void> }`. On mount it reads the token: none → `signedOut`, otherwise `signedIn`. While signed in it polls `auth.me` every `sessionCheckMs` and on window focus. A query or mutation `onError` where `isUnauthorized` is true clears the token and the query cache and moves to `signedOut`. Every other error leaves the session alone. `signOut` calls `auth.signOut`, ignores its errors, then clears locally.
  - `SignIn.tsx`: over the Scene, a `GlassPanel level="dialog"` with heading "Digital Life Hub", body "Sign in with your Google account to continue.", and one solid `Button`: "Sign in with Google" (or "Sign in (dev)" when the method is `devSignIn`). While signing in the button reads "Waiting for Google…" and stays enabled, so a second press restarts the attempt. Error copy by `reason`:
    - denied/cancelled: "Sign-in was cancelled."
    - timeout: "Sign-in timed out. Try again."
    - forbidden: "That Google account isn't allowed to use this hub."
    - expired: "Sign-in expired — try again."
    - network: "Can't reach the server. Check your connection and try again."
  - `App.tsx`: `App({ router, auth }: { router: AppRouter; auth: { tokenStore: TokenStore; method: SignInMethod; api: ReturnType<typeof createApi>; sessionCheckMs?: number } })` → `QueryClientProvider` + `TRPCProvider` + `AuthProvider`. `loading` renders only `<Scene />`, `signedOut`/`signingIn` render `<SignIn />`, and `signedIn` renders `<RouterProvider>`. `main.tsx` picks `tauriTokenStore` + `googleSignIn` when `isTauri()`, else `webTokenStore()` + `devSignIn`.
  - `test/apiHarness.ts`: `signedInApp(path?: string) → Promise<{ api: ReturnType<typeof createTestApi>; token: string; tokenStore: TokenStore; renderApp(): RenderResult; router }>`. It wires `createApi({ fetch: api.fetch, getToken: tokenStore.get })` to `createTestApi({ devAuth: true })`.

- [ ] **Step 1: Write the failing tests**

```ts
// auth.test.tsx
test("no stored token shows the sign-in screen, and dev sign-in reaches Home", async () => { /* memoryTokenStore(); method devSignIn → button "Sign in (dev)"; click → greeting visible; tokenStore.get() is the issued token */ });
test("a stored valid token opens straight into the shell", async () => { /* signedInApp("/") → Dock visible, no sign-in button */ });
test("revoked elsewhere → signed out on the next session check", async () => {
  /* sessionCheckMs: 50; render signed in; api.store.revokeSession(id) via devices.revoke from a second session;
     await findByRole("button", { name: /Sign in/ }); expect(await tokenStore.get()).toBeNull() */
});
test("server unreachable at launch keeps the token and the shell", async () => {
  /* fetch rejects with TypeError("Failed to fetch"); stored token "t"; → shell renders, tokenStore.get() still "t" */
});
test("a denied Google attempt shows the message and can retry", async () => {
  /* method rejects once with SignInError("denied") then resolves; click → "Sign-in was cancelled."; click again → shell */
});
test("FORBIDDEN from exchange shows the allowed-account message", async () => { /* method throws SignInError("forbidden") → exact copy */ });
```

Update `Shell.test.tsx` to render through `signedInApp("/")`. Its assertions stay the same.

- [ ] **Step 2–4:** fail, implement, pass (`pnpm --filter @dlh/desktop test` and `pnpm --filter @dlh/desktop typecheck`).
- [ ] **Step 5: Commit** — `feat(desktop): tRPC client, session gate and Google sign-in screen`.

---

### Task 8: Desktop — Settings → Devices and sign out

**Files:**
- Create: `apps/desktop/src/routes/settings/{Devices.tsx,lastActive.ts}`
- Modify: `apps/desktop/src/routes/Settings.tsx`
- Test: `apps/desktop/test/{devices.test.tsx,lastActive.test.ts}`

**Interfaces:**
- Consumes: `useTRPC`, `useAuth` (Task 7); `ItemRow`, `Chip`, `Button`, `Modal`, `Dialog` from `@dlh/ui`.
- Produces:
  - `formatLastActive(iso: string, now: Date): string`: "Active now" under 1 minute. Otherwise `Intl.RelativeTimeFormat("en", { numeric: "auto" })` in the largest whole unit among minute, hour and day ("5 minutes ago", "yesterday", "12 days ago").
  - `<Devices />`: a `glass-panel` section headed "Devices" (h2) under the Scene section. One `ItemRow` per session, newest-used first, showing `title = name`, `meta = "<macOS|Windows|Browser> · <lastActive>"`. The current row has a "This device" chip and no Revoke button. Other rows have a ghost "Revoke" button, which revokes and refetches. Below the list sits a "Sign out" button that opens a confirm `Dialog` titled "Sign out of this device?" with the buttons "Sign out" and "Cancel", then calls `useAuth().signOut()`.

- [ ] **Step 1: Write the failing tests**

```ts
// lastActive.test.ts
const now = new Date("2026-10-30T12:00:00Z");
test.each([["2026-10-30T11:59:30Z", "Active now"], ["2026-10-30T11:55:00Z", "5 minutes ago"], ["2026-10-29T09:00:00Z", "yesterday"], ["2026-10-18T12:00:00Z", "12 days ago"]])("%s → %s", (iso, out) => expect(formatLastActive(iso, now)).toBe(out));

// devices.test.tsx
test("lists both devices, marks this one, and revokes the other", async () => { /* api.signIn PC; signedInApp("/settings"); rows "Arek's PC" and "Browser (dev)"; "This device" chip in the dev row; click Revoke in the PC row → PC row gone; api.client(pcToken).auth.me → UNAUTHORIZED */ });
test("Sign out confirms, then shows the sign-in screen and clears the token", async () => { /* … */ });
test("Cancel keeps you signed in", async () => { /* … */ });
```

- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Commit** — `feat(desktop): Devices list with revoke and sign out`.

---

### Task 9: `pnpm dev`, e2e, CI and milestone check

**Files:**
- Modify: `scripts/dev.ts`, `scripts/dev.test.ts`, `.github/workflows/ci.yml`, `apps/desktop/playwright.config.ts`, `apps/desktop/e2e/shell.spec.ts`
- Create: `apps/desktop/e2e/signIn.ts`, `apps/desktop/e2e/auth.spec.ts`

**Interfaces:**
- Produces:
  - `PreflightChecks` gains `hasDocker: () => boolean`, `dockerRunning: () => boolean` (`docker info` exits 0) and `hasApiEnv: () => boolean` (`apps/api/.env` exists). Check order: node_modules, cargo, docker on PATH, Docker running, API env. New messages:
    - `DOCKER_MISSING_MESSAGE = 'Docker is not installed — install Docker Desktop (https://www.docker.com/products/docker-desktop/).'`
    - `DOCKER_DOWN_MESSAGE = "Docker isn't running — start Docker Desktop, then run pnpm dev again."`
    - `API_ENV_MESSAGE = 'Copy apps/api/.env.example to apps/api/.env and fill in the Google client and ALLOWED_EMAIL.'`
  - `steps` become:
    1. `db`: `docker compose up -d --wait`
    2. `migrate`: `pnpm --filter @dlh/db migrate`
    3. `apps`: `pnpm exec turbo run dev --filter=@dlh/api --filter=@dlh/desktop --ui=stream`

    Ctrl+C stops step 3 only, and Postgres keeps running.
  - Playwright `webServer` becomes an array:
    - The API runs via `pnpm --filter @dlh/api exec tsx src/main.ts` with env `NODE_ENV=development`, `DATABASE_URL=<TEST_DATABASE_URL or default test URL>`, dummy Google values, `ALLOWED_EMAIL=e2e@example.test`, and URL `http://127.0.0.1:8787/health`.
    - `dev:web` runs as before.

    A `globalSetup` runs `freshTestDb()`.
  - `e2e/signIn.ts`: `signIn(page)` loads `/`, clicks "Sign in (dev)" and waits for the greeting. Every existing `shell.spec.ts` test calls it after `localStorage.clear()`.
  - CI:
    - The macOS/Windows `check` job drops `test:e2e` for desktop.
    - A new `server` job on `ubuntu-latest` runs a `postgres:18` service (`dlh`/`dlh`/`dlh`, `54329:5432`, health-cmd `pg_isready`). Its steps: install, `pnpm test:db`, `playwright install --with-deps webkit chromium`, `pnpm --filter @dlh/desktop test:e2e`, `pnpm --filter @dlh/api docker:build`.

- [ ] **Step 1: Write the failing tests**

```ts
// scripts/dev.test.ts (additions)
const ok = { hasNodeModules: () => true, hasCargo: () => true, hasDocker: () => true, dockerRunning: () => true, hasApiEnv: () => true };
test("Docker not running is reported before anything starts", () => expect(preflight({ ...ok, dockerRunning: () => false })).toEqual({ ok: false, message: DOCKER_DOWN_MESSAGE }));
test("missing apps/api/.env is reported", () => expect(preflight({ ...ok, hasApiEnv: () => false })).toEqual({ ok: false, message: API_ENV_MESSAGE }));
test("steps run db → migrate → apps", () => expect(steps.map((s) => s.name)).toEqual(["db", "migrate", "apps"]));

// apps/desktop/e2e/auth.spec.ts
test("dev sign-in survives a reload", async ({ page }) => { /* signIn(page); reload; greeting visible without the sign-in button */ });
test("Sign out from Settings → Devices returns to sign-in", async ({ page }) => { /* signIn; /settings; Sign out → confirm; sign-in button visible; reload → still signed out */ });
```

- [ ] **Step 2–4:** fail, implement, pass: `pnpm test:scripts`, then `pnpm --filter @dlh/desktop test:e2e` (with `docker compose up -d --wait` done).
- [ ] **Step 5: Verify milestone 2 on macOS (manual, real Google).**
  1. Fill `apps/api/.env`.
  2. Run `pnpm dev`. Expected: labelled `db`/`migrate` output, then interleaved `@dlh/api` and `@dlh/desktop` logs, and the window opens on the sign-in screen.
  3. Sign in with Google in the system browser. The tab says you can close it, and the app shows Home.
  4. Quit the app and run `pnpm dev` again. Expected: Home with no sign-in. Keychain Access shows `app.digitallifehub.desktop`.
  5. Run `pnpm --filter @dlh/api sessions revoke --all`. Within 30 s (or on window focus) the app returns to the sign-in screen.
  6. Sign in again. Settings → Devices shows this Mac as "This device".
  7. Run `pnpm dev:down` → Postgres stops. Then `pnpm db:reset` → exit 0.
- [ ] **Step 6: Verify on Windows.** Same as Step 5, and check Credential Manager for the entry. If no Windows machine is at hand, the CI `tauri build` on `windows-latest` stands in, and the manual check is noted as outstanding.
- [ ] **Step 7: Commit** — `chore: pnpm dev runs Postgres, migrations and the API; server CI job`.
