import { readFileSync } from "node:fs";
import { statusColors, typeColors } from "../src/tokens";

const css = readFileSync(new URL("../src/theme.css", import.meta.url), "utf8");

test("type colours match the spec", () => {
  expect(typeColors).toEqual({
    task: "#9FD9A8",
    note: "#F5CF7E",
    project: "#9EC2FF",
    event: "#F5A8A0",
    ai: "#CDB6FF",
  });
  expect(statusColors).toEqual({ in_progress: "#F5CF7E", review: "#9EC2FF" });
});
test("theme.css declares every type colour with the same value", () => {
  for (const [k, v] of Object.entries(typeColors))
    expect(css).toContain(`--color-type-${k}: ${v}`);
});
test("every glass recipe emits both backdrop-filter properties", () => {
  for (const cls of [
    "glass-panel",
    "glass-card",
    "glass-nav",
    "glass-dialog",
  ]) {
    const block = css.split(`.${cls}`)[1].split("}")[0];
    expect(block).toMatch(/-webkit-backdrop-filter:/);
    expect(block).toMatch(/[^-]backdrop-filter:/);
  }
});
test("radii are 10, 14, 18, 20, 24", () => {
  for (const r of [10, 14, 18, 20, 24])
    expect(css).toContain(`--radius-${r}: ${r}px`);
});
