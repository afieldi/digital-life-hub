import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { expect, test } from "vitest";
import { moduleFiles } from "./new-module";

const ROOT = resolve(import.meta.dirname, "..");

/** The dependency names in pnpm-workspace.yaml's `catalog:` block. */
function catalogNames(): Set<string> {
  const yaml = readFileSync(join(ROOT, "pnpm-workspace.yaml"), "utf8");
  const block = yaml.split(/^catalog:\n/m)[1] ?? "";
  const names = new Set<string>();
  for (const line of block.split("\n")) {
    const m = line.match(/^ {2}"?([^":]+(?::[^":]+)?)"?: /);
    if (!m) break;
    names.add(m[1] as string);
  }
  return names;
}

/** Every dependency a package.json takes from the catalog. */
function fromCatalog(pkg: Record<string, unknown>): string[] {
  return ["dependencies", "devDependencies", "peerDependencies"].flatMap(
    (section) =>
      Object.entries((pkg[section] ?? {}) as Record<string, string>)
        .filter(([, version]) => version === "catalog:")
        .map(([name]) => name),
  );
}

const packageJsons = [
  join(ROOT, "package.json"),
  ...["apps", "packages", "modules"].flatMap((dir) =>
    readdirSync(join(ROOT, dir)).map((name) =>
      join(ROOT, dir, name, "package.json"),
    ),
  ),
].filter((path) => {
  try {
    readFileSync(path);
    return true;
  } catch {
    return false;
  }
});

test("every catalog: dependency in the workspace has a catalog entry", () => {
  const catalog = catalogNames();
  expect(catalog.size).toBeGreaterThan(0);
  for (const path of packageJsons) {
    const pkg = JSON.parse(readFileSync(path, "utf8"));
    for (const name of fromCatalog(pkg)) {
      expect(catalog, `${name} in ${path}`).toContain(name);
    }
  }
});

test("a new module's catalog: dependencies have catalog entries", () => {
  const catalog = catalogNames();
  const files = moduleFiles({
    id: "notes",
    type: "note",
    label: "Notes",
    key: "n",
  });
  const pkg = JSON.parse(files["package.json"] ?? "{}");
  const names = fromCatalog(pkg);
  expect(names.length).toBeGreaterThan(0);
  for (const name of names) expect(catalog, name).toContain(name);
});
