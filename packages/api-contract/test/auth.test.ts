import { deviceInput, loopbackRedirectUri } from "../src";

test.each([
  ["http://127.0.0.1:53682/callback", true],
  ["http://127.0.0.1:1/callback", true],
  ["http://localhost:53682/callback", false],
  ["https://127.0.0.1:53682/callback", false],
  ["http://127.0.0.1:53682/callback?x=1", false],
  ["http://127.0.0.1:0/callback", false],
  ["http://127.0.0.1:65536/callback", false],
  ["http://127.0.0.1.evil.com:80/callback", false],
  ["http://127.0.0.1:80/other", false],
])("redirect %s → %s", (uri, ok) =>
  expect(loopbackRedirectUri.safeParse(uri).success).toBe(ok),
);

test("device name is trimmed and required", () => {
  expect(
    deviceInput.parse({ name: "  Arek's Mac ", platform: "macos" }).name,
  ).toBe("Arek's Mac");
  expect(
    deviceInput.safeParse({ name: "   ", platform: "macos" }).success,
  ).toBe(false);
  expect(deviceInput.safeParse({ name: "PC", platform: "linux" }).success).toBe(
    false,
  );
});
