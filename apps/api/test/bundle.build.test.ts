import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Builds into a temp dir (self-contained, ~1s) so the check never depends on
// a stale dist/. Production code must not ship the schema-dropping reset.
function bundleFiles(extraArgs: string[]): { name: string; text: string }[] {
  const out = mkdtempSync(join(tmpdir(), "dlh-api-bundle-"));
  try {
    const res = spawnSync(
      "pnpm",
      ["exec", "tsup", "--out-dir", out, ...extraArgs],
      { encoding: "utf8", shell: process.platform === "win32" },
    );
    expect(res.error, `spawning pnpm failed: ${res.error}`).toBeUndefined();
    expect(res.status, res.stderr).toBe(0);
    const files = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
      );
    return files(out).map((name) => ({
      name,
      text: readFileSync(name, "utf8"),
    }));
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}

// A real tsup build of the API, @dlh/server and every module takes several
// seconds on CI runners (7.5s seen on Windows), well past vitest's 5s default.
const BUILD_TIMEOUT_MS = 60_000;

test.each([
  ["default", []],
  ["without code splitting", ["--no-splitting"]],
])(
  "production bundle never contains schema-dropping code (%s)",
  (_n, args) => {
    const files = bundleFiles(args);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      expect(f.text.toLowerCase(), f.name).not.toContain("drop schema");
    }
  },
  BUILD_TIMEOUT_MS,
);
