import { DEFAULT_TEST_DATABASE_URL } from "@dlh/db";
import { defineConfig, devices } from "@playwright/test";
import { E2E_API_PORT, E2E_API_URL } from "./e2e/apiUrl";

// 1420 is Tauri's conventional dev port (tauri.conf.json devUrl). Never reuse
// an existing server: a stale one would be tested instead of this checkout.
const port = 1420;
// Must be the database e2e/prepareDb.ts resets (freshTestDb reads the same variable).
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${port}` },
  webServer: [
    {
      // devSignIn exists only under NODE_ENV=development. Google values are dummies.
      // Reset the database first, then start the API on the fresh schema.
      command:
        "pnpm --filter @dlh/desktop exec tsx e2e/prepareDb.ts && pnpm --filter @dlh/api exec tsx src/main.ts",
      url: `${E2E_API_URL}/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "development",
        PORT: String(E2E_API_PORT),
        DATABASE_URL: testDatabaseUrl,
        GOOGLE_CLIENT_ID: "e2e-client-id",
        GOOGLE_CLIENT_SECRET: "e2e-client-secret",
        ALLOWED_EMAIL: "e2e@example.test",
        // A scripted OpenRouter stand-in (honoured only under NODE_ENV=development).
        AI_FAKE_PROVIDER: "1",
      },
    },
    {
      command: "pnpm dev:web",
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
      env: { VITE_API_URL: E2E_API_URL },
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
