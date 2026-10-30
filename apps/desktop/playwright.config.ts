import { DEFAULT_TEST_DATABASE_URL } from "@dlh/db";
import { defineConfig, devices } from "@playwright/test";

// 1420 is Tauri's conventional dev port (tauri.conf.json devUrl). Never reuse
// an existing server: a stale one would be tested instead of this checkout.
const port = 1420;
const apiUrl = "http://127.0.0.1:8787";
// Must be the database globalSetup resets (freshTestDb reads the same variable).
const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${port}` },
  globalSetup: "./e2e/globalSetup.ts",
  webServer: [
    {
      // devSignIn exists only under NODE_ENV=development. Google values are dummies.
      command: "pnpm --filter @dlh/api exec tsx src/main.ts",
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      env: {
        NODE_ENV: "development",
        DATABASE_URL: testDatabaseUrl,
        GOOGLE_CLIENT_ID: "e2e-client-id",
        GOOGLE_CLIENT_SECRET: "e2e-client-secret",
        ALLOWED_EMAIL: "e2e@example.test",
      },
    },
    {
      command: "pnpm dev:web",
      url: `http://localhost:${port}`,
      reuseExistingServer: false,
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
