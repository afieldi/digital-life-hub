import { expect, test } from "vitest";
import { ageLabel } from "../src/age";

const now = new Date("2026-11-02T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms);
const S = 1000;
const M = 60 * S;
const H = 60 * M;
const D = 24 * H;

test("under a minute is now", () => {
  expect(ageLabel(ago(30 * S), now)).toBe("now");
  expect(ageLabel(ago(59 * S), now)).toBe("now");
});
test("minutes, hours, days, weeks", () => {
  expect(ageLabel(ago(60 * S), now)).toBe("1m");
  expect(ageLabel(ago(5 * M), now)).toBe("5m");
  expect(ageLabel(ago(2 * H), now)).toBe("2h");
  expect(ageLabel(ago(3 * D), now)).toBe("3d");
  expect(ageLabel(ago(6 * D), now)).toBe("6d");
  expect(ageLabel(ago(7 * D), now)).toBe("1w");
  expect(ageLabel(ago(20 * D), now)).toBe("2w");
});
test("a future time is now", () => {
  expect(ageLabel(new Date(now.getTime() + 5 * M), now)).toBe("now");
});
test("accepts an ISO string", () => {
  expect(ageLabel("2026-11-02T10:00:00Z", now)).toBe("2h");
});
