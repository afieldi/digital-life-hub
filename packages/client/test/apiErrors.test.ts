import { TRPCClientError } from "@trpc/client";
import { apiErrorKind, apiErrorMessage, isTransient } from "../src";

/** A client error as the API sends it, with the tRPC code it carries. */
const failure = (code: string, message = "nope") =>
  Object.assign(new TRPCClientError(message), { data: { code } });

test("apiErrorKind reads the tRPC code", () => {
  expect(apiErrorKind(failure("CONFLICT"))).toBe("conflict");
  expect(apiErrorKind(failure("NOT_FOUND"))).toBe("gone");
  expect(apiErrorKind(failure("BAD_REQUEST"))).toBe("invalid");
  expect(apiErrorKind(failure("FORBIDDEN"))).toBe("forbidden");
  expect(apiErrorKind(failure("UNAUTHORIZED"))).toBe("unauthorized");
  expect(apiErrorKind(failure("INTERNAL_SERVER_ERROR"))).toBe("server");
  // No code: the request never got an answer.
  expect(apiErrorKind(new TRPCClientError("fetch failed"))).toBe("network");
  // Not from the API at all: a bug in the app.
  expect(apiErrorKind(new TypeError("x is undefined"))).toBe("server");
});

test("only network and server failures are worth retrying", () => {
  expect(isTransient(new TRPCClientError("fetch failed"))).toBe(true);
  expect(isTransient(failure("INTERNAL_SERVER_ERROR"))).toBe(true);
  for (const code of ["NOT_FOUND", "BAD_REQUEST", "CONFLICT", "UNAUTHORIZED"]) {
    expect(isTransient(failure(code)), code).toBe(false);
  }
});

test("apiErrorMessage gives a refused input's own words, else the fallback", () => {
  expect(
    apiErrorMessage(failure("BAD_REQUEST", "title is too long"), "x"),
  ).toBe("title is too long");
  // A schema failure's message is the raw issue list.
  expect(
    apiErrorMessage(failure("BAD_REQUEST", '[{"code":"too_big"}]'), "x"),
  ).toBe("x");
  expect(apiErrorMessage(failure("INTERNAL_SERVER_ERROR", "db"), "x")).toBe(
    "x",
  );
});
