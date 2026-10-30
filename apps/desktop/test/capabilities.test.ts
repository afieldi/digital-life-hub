import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("the default capability grants the OS host name used for device naming", () => {
  // vitest runs with the package root as cwd.
  const file = resolve(process.cwd(), "src-tauri/capabilities/default.json");
  const cap = JSON.parse(readFileSync(file, "utf8")) as {
    permissions: unknown[];
  };
  expect(cap.permissions).toContain("os:allow-hostname");
});
