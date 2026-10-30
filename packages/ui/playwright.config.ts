import { defineConfig, devices } from "@playwright/test";

// Never reuse an existing server: a stale gallery on the port would be
// screenshotted instead of this checkout. Set GALLERY_PORT to run next to
// another checkout's server.
const port = Number(process.env.GALLERY_PORT ?? 6006);

export default defineConfig({
  testDir: "e2e",
  snapshotPathTemplate:
    "{testDir}/__screenshots__/{platform}/{projectName}/{arg}{ext}",
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01 } },
  use: { baseURL: `http://localhost:${port}` },
  webServer: {
    command: `pnpm gallery --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
  },
  projects: [
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
