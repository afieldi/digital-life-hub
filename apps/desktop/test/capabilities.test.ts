import { readFileSync } from "node:fs";
import { resolve } from "node:path";

type Permission = string | { identifier: string };

function permissions(): Permission[] {
  // vitest runs with the package root as cwd.
  const file = resolve(process.cwd(), "src-tauri/capabilities/default.json");
  const cap = JSON.parse(readFileSync(file, "utf8")) as {
    permissions: Permission[];
  };
  return cap.permissions;
}

test("the default capability grants the OS host name used for device naming", () => {
  expect(permissions()).toContain("os:allow-hostname");
});

test("no permission starts with shell: or process:", () => {
  // The AI CLI runner (src-tauri/src/cli.rs) is the app's only process spawning;
  // the webview must not get a general shell or process permission.
  const ids = permissions().map((p) =>
    typeof p === "string" ? p : p.identifier,
  );
  expect(ids.length).toBeGreaterThan(0);
  for (const id of ids) {
    expect(id).not.toMatch(/^(shell|process):/);
  }
});
