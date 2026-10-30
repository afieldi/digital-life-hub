import { DEFAULT_DATABASE_URL, databaseUrlFrom } from "../src";

test("an unset or empty DATABASE_URL falls back to the Docker Postgres", () => {
  expect(databaseUrlFrom({})).toBe(DEFAULT_DATABASE_URL);
  // apps/api/.env.example ships `DATABASE_URL=` empty.
  expect(databaseUrlFrom({ DATABASE_URL: "" })).toBe(DEFAULT_DATABASE_URL);
});

test("a set DATABASE_URL wins", () => {
  expect(databaseUrlFrom({ DATABASE_URL: "postgres://x@db:5432/x" })).toBe(
    "postgres://x@db:5432/x",
  );
});
