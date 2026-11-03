import { TRPCClientError } from "@trpc/client";
import { toSignInError } from "../src/auth/signIn";

/** A tRPC failure with the code and HTTP status the API sent. */
const failure = (code: string, httpStatus: number) =>
  Object.assign(new TRPCClientError("x"), { data: { code, httpStatus } });

test("sign-in failures map to what the person can do about them", () => {
  expect(toSignInError(failure("FORBIDDEN", 403)).reason).toBe("forbidden");
  expect(toSignInError(failure("BAD_REQUEST", 400)).reason).toBe("expired");
  // Google failing or timing out, or the server failing, is not an expiry.
  expect(toSignInError(failure("BAD_GATEWAY", 502)).reason).toBe("unavailable");
  expect(toSignInError(failure("INTERNAL_SERVER_ERROR", 500)).reason).toBe(
    "unavailable",
  );
  expect(toSignInError(new TRPCClientError("fetch failed")).reason).toBe(
    "network",
  );
  expect(toSignInError("cancelled").reason).toBe("cancelled");
});
