import { existsSync, globSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vitest";

// apps/desktop/test/moduleParity.test.ts compares the client and server
// registries. These check what only the folder layout can: migrations are
// found at modules/<id>/drizzle, and the Docker image copies by folder.

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// globSync returns backslash paths on Windows.
const dirs = globSync("modules/*/src/server.ts", { cwd: ROOT }).map(
  (f) => f.split(/[\\/]/)[1] ?? "",
);

/** What these checks read of a module's server entry. */
type ServerEntry = { id: string; migrations?: true };

const serverModule = async (dir: string): Promise<ServerEntry> =>
  (
    (await import(
      pathToFileURL(join(ROOT, "modules", dir, "src", "server.ts")).href
    )) as { default: ServerEntry }
  ).default;

test("there are modules to check", () =>
  expect(dirs.length).toBeGreaterThan(0));

test.each(dirs)("%s: the folder is named after the module id", async (dir) => {
  expect((await serverModule(dir)).id).toBe(dir);
});

test.each(dirs)(
  "%s: `migrations` is set exactly when it has a drizzle journal",
  async (dir) => {
    const journal = join(
      ROOT,
      "modules",
      dir,
      "drizzle",
      "meta",
      "_journal.json",
    );
    expect(Boolean((await serverModule(dir)).migrations)).toBe(
      existsSync(journal),
    );
  },
);
