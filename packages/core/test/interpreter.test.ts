import {
  aiSettings,
  interpreterFor,
  interpreterId,
  interpreters,
  keywordInterpreter,
} from "../src";

test("Settings' interpreter id picks from the registry; an unknown one reads as keywords", () => {
  expect(interpreterId.options).toEqual(Object.keys(interpreters));
  expect(interpreterFor("keywords")).toBe(keywordInterpreter);
  expect(interpreterFor("gone")).toBe(keywordInterpreter);
  expect(interpreterFor(undefined)).toBe(keywordInterpreter);
  expect(aiSettings.shape.interpreter.safeParse("model").success).toBe(false);
});
