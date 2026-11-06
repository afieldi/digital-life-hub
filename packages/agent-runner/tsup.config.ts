import { defineConfig } from "tsup";

/**
 * The runner and the MCP launcher for the image, at `/opt/runner`. Everything
 * is bundled but the Agent SDK, whose CLI is a per-platform binary package,
 * and zod, which the SDK shares (both installed beside it by `pnpm deploy`).
 */
export default defineConfig({
  entry: ["src/main.ts", "src/mcp.ts"],
  format: ["esm"],
  platform: "node",
  target: "node22",
  outDir: "dist",
  clean: true,
  splitting: false,
  noExternal: [/^(?!@anthropic-ai\/claude-agent-sdk|zod)/],
  external: ["@anthropic-ai/claude-agent-sdk", "zod"],
});
