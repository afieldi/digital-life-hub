import { expect, test } from "vitest";
import { parseListSearch } from "../src/screens/lastList";

test("a real week day is kept; a bad one is dropped, so the current week shows", () => {
  expect(parseListSearch({ week: "2026-11-09" })).toEqual({
    week: "2026-11-09",
  });
  expect(parseListSearch({ week: "2026-13-45" })).toEqual({});
  expect(parseListSearch({ week: "2026-02-30" })).toEqual({});
  expect(parseListSearch({ week: "soon" })).toEqual({});
});

test("High only is on only when true", () => {
  expect(parseListSearch({ high: true })).toEqual({ high: true });
  expect(parseListSearch({ high: "true" })).toEqual({ high: true });
  expect(parseListSearch({ high: 1 })).toEqual({});
});
