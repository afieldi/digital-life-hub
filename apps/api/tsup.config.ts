import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/main.ts", "src/cli/sessions.ts"],
  format: ["esm"],
  outDir: "dist",
  clean: true,
  noExternal: [/^@dlh\//],
});
