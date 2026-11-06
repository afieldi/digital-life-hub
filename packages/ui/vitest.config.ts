import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["test/setup.ts"],
    exclude: ["e2e/**", "node_modules/**"],
    // The form tests type with userEvent; with every package's suite running at
    // once in CI they can take over the default 5 s.
    testTimeout: 15_000,
  },
});
