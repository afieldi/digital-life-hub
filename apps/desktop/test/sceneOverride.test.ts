import { readSceneOverride } from "../src/shell/sceneOverride";

test.each([
  ["dusk", "dusk"],
  ["night", "night"],
  ["morning", "morning"],
  [null, null],
  ["noon", null],
  ['{"x":1}', null],
])("%s → %s", (raw, out) => expect(readSceneOverride(raw)).toBe(out));
