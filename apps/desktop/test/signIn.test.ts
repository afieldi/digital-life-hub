import { createTestApi } from "@dlh/api/testing";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { hostname, platform } from "@tauri-apps/plugin-os";
import { createApi } from "../src/api/client";
import { googleSignIn, SignInError } from "../src/auth/signIn";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));
vi.mock("@tauri-apps/plugin-os", () => ({
  hostname: vi.fn(),
  platform: vi.fn(),
}));

const mockInvoke = vi.mocked(invoke);

/** Fake Tauri loopback: `wait` settles with `outcome` (a code, or a Rust error string). */
function loopback(outcome: { code: string } | { error: string }) {
  mockInvoke.mockImplementation(async (cmd) => {
    if (cmd === "auth_loopback_start") return { port: 5123, attempt: 7 };
    if (cmd === "auth_loopback_wait") {
      if ("error" in outcome) throw outcome.error;
      return outcome.code;
    }
    throw new Error(`unexpected command ${cmd}`);
  });
}

function setup() {
  const api = createTestApi();
  const { trpcClient } = createApi({
    fetch: api.fetch,
    getToken: async () => null,
  });
  return { api, trpcClient };
}

beforeEach(() => {
  vi.mocked(hostname).mockResolvedValue("arek-mbp");
  vi.mocked(platform).mockReturnValue("macos");
});

afterEach(() => {
  vi.resetAllMocks();
});

async function reasonOf(p: Promise<unknown>): Promise<string> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(SignInError);
  return (err as SignInError).reason;
}

test("runs the loopback flow and registers this device", async () => {
  const { api, trpcClient } = setup();
  loopback({ code: "google-code" });

  const token = await googleSignIn(trpcClient);

  expect(api.google.lastAuthUrlArgs?.redirectUri).toBe(
    "http://127.0.0.1:5123/callback",
  );
  const state = api.google.lastAuthUrlArgs?.state;
  expect(vi.mocked(openUrl)).toHaveBeenCalledWith(
    `https://accounts.google.com/o/oauth2/v2/auth?state=${state}`,
  );
  expect(mockInvoke).toHaveBeenCalledWith("auth_loopback_wait", {
    attempt: 7,
    expectedState: state,
  });
  expect(api.google.lastExchangeArgs?.code).toBe("google-code");
  const devices = await api.client(token).devices.list.query();
  expect(devices).toMatchObject([
    { name: "arek-mbp", platform: "macos", current: true },
  ]);
});

test("falls back to a generic device name and the web platform", async () => {
  const { api, trpcClient } = setup();
  loopback({ code: "google-code" });
  vi.mocked(hostname).mockResolvedValue(null);
  vi.mocked(platform).mockReturnValue("linux");

  const token = await googleSignIn(trpcClient);

  const devices = await api.client(token).devices.list.query();
  expect(devices).toMatchObject([{ name: "This computer", platform: "web" }]);
});

test.each([
  ["denied", "denied"],
  ["cancelled", "cancelled"],
  ["timeout", "timeout"],
  ["state_mismatch", "expired"],
  ["bad_request", "expired"],
  ["something new", "expired"],
])("loopback error %s → %s", async (rust, reason) => {
  const { trpcClient } = setup();
  loopback({ error: rust });
  expect(await reasonOf(googleSignIn(trpcClient))).toBe(reason);
});

test("a disallowed Google account → forbidden", async () => {
  const { api, trpcClient } = setup();
  api.google.identity.email = "someone@example.com";
  loopback({ code: "google-code" });
  expect(await reasonOf(googleSignIn(trpcClient))).toBe("forbidden");
});

test("an unreachable server → network", async () => {
  const { trpcClient } = createApi({
    fetch: () => Promise.reject(new TypeError("Failed to fetch")),
    getToken: async () => null,
  });
  loopback({ code: "google-code" });
  expect(await reasonOf(googleSignIn(trpcClient))).toBe("network");
});

test("a rejected hostname() still signs in as This computer", async () => {
  const { api, trpcClient } = setup();
  loopback({ code: "google-code" });
  vi.mocked(hostname).mockRejectedValue("os.hostname not allowed");

  const token = await googleSignIn(trpcClient);

  const devices = await api.client(token).devices.list.query();
  expect(devices).toMatchObject([{ name: "This computer", platform: "macos" }]);
});

test("a 150-character hostname is sent capped at 100", async () => {
  const { api, trpcClient } = setup();
  loopback({ code: "google-code" });
  vi.mocked(hostname).mockResolvedValue(`  ${"h".repeat(150)}  `);

  const token = await googleSignIn(trpcClient);

  const [device] = await api.client(token).devices.list.query();
  expect(device?.name).toBe("h".repeat(100));
});

test("an unrecognised failure is logged without leaking the code", async () => {
  const { trpcClient } = setup();
  loopback({ error: "something new" });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  await reasonOf(googleSignIn(trpcClient));
  expect(warn).toHaveBeenCalledWith(expect.any(String), "something new");
  warn.mockRestore();
});
