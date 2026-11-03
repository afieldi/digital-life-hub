import { defineConfig } from "vitest/config";

export default defineConfig({
  // A test's first fresh database may wait for its template's migrations.
  test: { globals: true, environment: "node", testTimeout: 30_000 },
});
