import { defineConfig, devices } from "@playwright/test";

// 1420 is Tauri's conventional dev port (tauri.conf.json devUrl). Never reuse
// an existing server: a stale one would be tested instead of this checkout.
const port = 1420;

export default defineConfig({
  testDir: "e2e",
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: "pnpm dev:web",
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
