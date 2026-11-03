import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineServerModule, moduleConfigKeys } from "@dlh/server";
import { z } from "zod";
import {
  ConfigError,
  databaseSection,
  loadConfig,
  must,
  openrouterSection,
} from "../src/config";
import { serverModules } from "../src/modules.gen";

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

test("host defaults to loopback and is trimmed", () => {
  expect(loadConfig(base).host).toBe("127.0.0.1");
  expect(loadConfig({ ...base, HOST: " 0.0.0.0 " }).host).toBe("0.0.0.0");
});

test("refuses dev auth on a host other than loopback", () => {
  for (const HOST of ["127.0.0.1", "::1", "localhost"]) {
    expect(loadConfig({ ...base, NODE_ENV: "development", HOST }).devAuth).toBe(
      true,
    );
  }
  expect(() =>
    loadConfig({ ...base, NODE_ENV: "development", HOST: "0.0.0.0" }),
  ).toThrow(ConfigError);
  expect(loadConfig({ ...base, HOST: "0.0.0.0" }).devAuth).toBe(false);
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

test("OpenRouter variables are optional and trimmed", () => {
  expect(loadConfig(base).openrouter).toEqual({
    apiKey: null,
    defaultModel: null,
  });
  expect(
    loadConfig({
      ...base,
      OPENROUTER_API_KEY: "  ",
      OPENROUTER_DEFAULT_MODEL: "",
    }).openrouter,
  ).toEqual({ apiKey: null, defaultModel: null });
  expect(
    loadConfig({
      ...base,
      OPENROUTER_API_KEY: " sk-x ",
      OPENROUTER_DEFAULT_MODEL: " a/b ",
    }).openrouter,
  ).toEqual({ apiKey: "sk-x", defaultModel: "a/b" });
});

test("PORT must be a whole number from 1 to 65535", () => {
  expect(loadConfig({ ...base, PORT: " 9000 " }).port).toBe(9000);
  for (const PORT of ["abc", "80800", "0", "8.5"]) {
    expect(() => loadConfig({ ...base, PORT }), PORT).toThrow(ConfigError);
  }
});

test("DATABASE_URL is required in production, else defaults to the local database", () => {
  expect(() => loadConfig({ ...base, NODE_ENV: "production" })).toThrow(
    /DATABASE_URL/,
  );
  expect(
    loadConfig({ ...base, NODE_ENV: "production", DATABASE_URL: " pg://x " })
      .databaseUrl,
  ).toBe("pg://x");
  expect(loadConfig(base).databaseUrl).toMatch(/^postgres:\/\//);
});

test("start-up switches are read once, here", () => {
  expect(loadConfig(base)).toMatchObject({
    migrateOnStart: false,
    migrationsRoot: null,
    aiFake: false,
  });
  expect(
    loadConfig({ ...base, MIGRATE_ON_START: "1", MIGRATIONS_ROOT: "/app" }),
  ).toMatchObject({ migrateOnStart: true, migrationsRoot: "/app" });
  // The scripted AI fake only ever runs in development.
  expect(
    loadConfig({ ...base, AI_FAKE_PROVIDER: "1", NODE_ENV: "development" })
      .aiFake,
  ).toBe(true);
  expect(
    loadConfig({
      ...base,
      AI_FAKE_PROVIDER: "1",
      NODE_ENV: "production",
      DATABASE_URL: "pg://x",
    }).aiFake,
  ).toBe(false);
});

test("a CLI loads only the sections it needs", () => {
  // No Google variables: the database section alone is fine.
  expect(must(databaseSection({})).url).toMatch(/^postgres:\/\//);
  expect(() => must(databaseSection({ NODE_ENV: "production" }))).toThrow(
    ConfigError,
  );
  expect(must(openrouterSection({ OPENROUTER_API_KEY: " k " }))).toEqual({
    apiKey: "k",
    defaultModel: null,
  });
});

test("modules' variables are checked with the API's, in one error", () => {
  const notes = defineServerModule({
    id: "notes",
    itemTypes: [],
    operations: {},
    config: { prefix: "NOTES_", schema: z.object({ BUCKET: z.string() }) },
  });
  try {
    loadConfig({ GOOGLE_CLIENT_ID: "id" }, [notes]);
    expect.unreachable();
  } catch (e) {
    expect((e as ConfigError).missing).toEqual([
      "GOOGLE_CLIENT_SECRET",
      "ALLOWED_EMAIL",
      "NOTES_BUCKET",
    ]);
  }
  const ok = loadConfig({ ...base, NOTES_BUCKET: "b" }, [notes]);
  expect(ok.moduleConfig.get("notes")).toEqual({ BUCKET: "b" });
});

test("every module variable is listed in .env.example", () => {
  const example = readFileSync(
    fileURLToPath(new URL("../.env.example", import.meta.url)),
    "utf8",
  );
  for (const m of serverModules) {
    for (const key of m.config ? moduleConfigKeys(m.config) : []) {
      expect(example, key).toMatch(new RegExp(`^#? ?${key}=`, "m"));
    }
  }
});
