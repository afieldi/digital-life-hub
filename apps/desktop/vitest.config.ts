import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    // DB-backed test files share one Postgres database.
    fileParallelism: false,
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
  },
});
