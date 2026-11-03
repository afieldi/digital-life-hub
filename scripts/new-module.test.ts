import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vitest";
import { moduleFiles, problemWith, writeModule } from "./new-module";

const notes = { id: "notes", type: "note", label: "Notes", key: "n" };

test("ids, types and keys must be plain lowercase", () => {
  expect(problemWith(notes)).toBeNull();
  expect(problemWith({ ...notes, id: "Notes" })).toMatch(/id/);
  expect(problemWith({ ...notes, id: "my-notes" })).toMatch(/id/);
  expect(problemWith({ ...notes, type: "a note" })).toMatch(/item type/);
  expect(problemWith({ ...notes, key: "nn" })).toMatch(/key/);
});

test("a new module is described once and has both halves, a page and a DB test", () => {
  const files = moduleFiles(notes);
  expect(Object.keys(files).sort()).toEqual([
    "package.json",
    "src/NotesPage.tsx",
    "src/manifest.tsx",
    "src/module.ts",
    "src/operations.ts",
    "src/server.ts",
    "test/create.db.test.ts",
    "tsconfig.json",
    "vitest.config.ts",
  ]);
  expect(files["src/module.ts"]).toContain('id: "notes"');
  expect(files["src/module.ts"]).toContain('itemTypes: ["note"]');
  expect(files["src/manifest.tsx"]).toContain("defineModule(notesModule");
  expect(files["src/server.ts"]).toContain("defineServerModule(notesModule");
  expect(files["src/manifest.tsx"]).toContain('key: "n"');
  expect(JSON.parse(files["package.json"] ?? "").name).toBe(
    "@dlh/module-notes",
  );
});

test("writeModule refuses a folder that exists", () => {
  const root = mkdtempSync(join(tmpdir(), "new-module-"));
  try {
    const written = writeModule(notes, root);
    expect(written).toContain("modules/notes/src/module.ts");
    expect(
      readFileSync(join(root, "modules/notes/src/operations.ts"), "utf8"),
    ).toContain('id: "notes.create"');
    expect(() => writeModule(notes, root)).toThrow(/already exists/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
