import { ConfigError, loadConfig } from "../src/config";

const base = {
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "s",
  ALLOWED_EMAIL: " Arek@Example.com ",
};

test("normalises the allowed email and defaults port and devAuth", () => {
  const c = loadConfig(base);
  expect(c).toMatchObject({
    port: 8787,
    allowedEmail: "arek@example.com",
    devAuth: false,
  });
  expect(loadConfig({ ...base, NODE_ENV: "development" }).devAuth).toBe(true);
});

test("lists every missing variable", () => {
  try {
    loadConfig({});
    expect.unreachable();
  } catch (e) {
    expect(e).toBeInstanceOf(ConfigError);
    expect((e as ConfigError).missing).toEqual([
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
      "ALLOWED_EMAIL",
    ]);
  }
});

test("rejects an allowed email that is not an email", () => {
  expect(() => loadConfig({ ...base, ALLOWED_EMAIL: "nope" })).toThrow(
    ConfigError,
  );
});
