import { describe, expect, it } from "vitest";
import {
  CARGO_MISSING_MESSAGE,
  NODE_MODULES_MESSAGE,
  preflight,
  steps,
} from "./dev";

describe("preflight", () => {
  it("fails with the install message when node_modules is missing", () => {
    const r = preflight({ hasNodeModules: () => false, hasCargo: () => true });
    expect(r).toEqual({ ok: false, message: 'Run "pnpm install" first.' });
    expect(NODE_MODULES_MESSAGE).toBe('Run "pnpm install" first.');
  });

  it("fails with the Rust message when cargo is missing", () => {
    const r = preflight({ hasNodeModules: () => true, hasCargo: () => false });
    expect(r).toEqual({ ok: false, message: CARGO_MISSING_MESSAGE });
    expect(CARGO_MISSING_MESSAGE).toContain("https://rustup.rs");
    expect(CARGO_MISSING_MESSAGE).toContain("dev:web");
  });

  it("checks node_modules before cargo", () => {
    const r = preflight({ hasNodeModules: () => false, hasCargo: () => false });
    expect(r).toEqual({ ok: false, message: NODE_MODULES_MESSAGE });
  });

  it("passes when both are present", () => {
    expect(
      preflight({ hasNodeModules: () => true, hasCargo: () => true }),
    ).toEqual({ ok: true });
  });
});

describe("steps", () => {
  it("has the desktop dev step", () => {
    expect(steps.map((s) => s.name)).toEqual(["desktop"]);
  });
});
