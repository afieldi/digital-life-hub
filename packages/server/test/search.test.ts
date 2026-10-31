import { escapeLike } from "../src/items/search";

test("escapeLike escapes %, _ and backslash", () => {
  expect(escapeLike("50%_a\\b")).toBe("50\\%\\_a\\\\b");
});
