import { globSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const read = (rel: string) => readFileSync(`${ROOT}${rel}`, "utf8");
// globSync returns backslash paths on Windows.
const dirs = globSync("modules/*/src/server.ts", { cwd: ROOT }).map(
  (f) => f.split(/[\\/]/)[1] ?? "",
);

/** The first top-level `id: "..."` after `defineServerModule(` / `defineModule(`. */
const moduleId = (src: string, marker: RegExp) => {
  const at = src.search(marker);
  return /\bid:\s*"([^"]+)"/.exec(src.slice(at))?.[1];
};

test("there are modules to check", () =>
  expect(dirs.length).toBeGreaterThan(0));

test.each(dirs)("%s: server id matches manifest id", (dir) => {
  const server = read(`modules/${dir}/src/server.ts`);
  const manifest = read(`modules/${dir}/src/manifest.tsx`);
  const serverId = moduleId(server, /defineServerModule\(/);
  const manifestId = moduleId(manifest, /^\s*id:\s*"/m);
  expect(serverId).toBeDefined();
  expect(serverId).toBe(manifestId);
});

test.each(dirs)(
  "%s: every server item type has a manifest item type",
  (dir) => {
    const server = read(`modules/${dir}/src/server.ts`);
    const manifest = read(`modules/${dir}/src/manifest.tsx`);
    const list = /itemTypes:\s*\[([^\]]*)\]/.exec(server)?.[1] ?? "";
    const types = [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    const manifestTypes = [
      ...manifest.matchAll(/itemType:\s*\{\s*type:\s*"([^"]+)"/g),
    ].map((m) => m[1]);
    expect(types.length).toBeGreaterThan(0);
    for (const t of types) expect(manifestTypes).toContain(t);
  },
);
