import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { statusColors } from "../src/tokens";

const css = readFileSync(
  resolve(import.meta.dirname, "../src/theme.css"),
  "utf8",
);

test("status colours match the spec", () => {
  expect(statusColors).toEqual({ in_progress: "#F5CF7E", review: "#9EC2FF" });
});
test("theme.css declares the type colours from the spec", () => {
  const spec = {
    task: "#9fd9a8",
    note: "#f5cf7e",
    project: "#9ec2ff",
    event: "#f5a8a0",
    ai: "#cdb6ff",
  };
  for (const [k, v] of Object.entries(spec))
    expect(css.toLowerCase()).toContain(`--color-type-${k}: ${v}`);
});
test("every glass recipe emits both backdrop-filter properties", () => {
  for (const cls of [
    "glass-panel",
    "glass-card",
    "glass-nav",
    "glass-dialog",
  ]) {
    const block = css.split(`@utility ${cls} `)[1].split("}")[0];
    expect(block).toMatch(/-webkit-backdrop-filter:/);
    expect(block).toMatch(/[^-]backdrop-filter:/);
  }
});
test("radii are 10, 14, 18, 20, 24", () => {
  for (const r of [10, 14, 18, 20, 24])
    expect(css).toContain(`--radius-${r}: ${r}px`);
});
