import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    // A DB test's first fresh database may wait for its template's migrations.
    testTimeout: 30_000,
    exclude: ["e2e/**", "node_modules/**"],
  },
});
