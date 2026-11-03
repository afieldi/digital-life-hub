import { z } from "zod";
import {
  configFor,
  defineServerModule,
  loadModuleConfigs,
  moduleConfigKeys,
} from "../src";
import { testDeps } from "../src/testing";

const events = defineServerModule({
  id: "events",
  itemTypes: ["event"],
  operations: {},
  config: {
    prefix: "EVENTS_",
    schema: z.object({
      ICS_URL: z.url(),
      TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
    }),
  },
});
const plain = defineServerModule({
  id: "plain",
  itemTypes: [],
  operations: {},
});

test("moduleConfigKeys names the variables a module reads", () => {
  expect(events.config && moduleConfigKeys(events.config)).toEqual([
    "EVENTS_ICS_URL",
    "EVENTS_TIMEOUT_MS",
  ]);
});

test("a module's config is read, trimmed and typed; defaults apply", () => {
  const { values, missing } = loadModuleConfigs([events, plain], {
    EVENTS_ICS_URL: " https://cal.example/feed.ics ",
  });
  expect(missing).toEqual([]);
  expect(values.get("events")).toEqual({
    ICS_URL: "https://cal.example/feed.ics",
    TIMEOUT_MS: 5000,
  });
  expect(values.has("plain")).toBe(false);
});

test("missing and invalid variables are all listed, by their env names", () => {
  expect(loadModuleConfigs([events], {}).missing).toEqual(["EVENTS_ICS_URL"]);
  const { missing } = loadModuleConfigs([events], {
    EVENTS_ICS_URL: "not a url",
    EVENTS_TIMEOUT_MS: "-1",
  });
  expect(missing).toHaveLength(2);
  expect(missing[0]).toMatch(/^EVENTS_ICS_URL \(/);
  expect(missing[1]).toMatch(/^EVENTS_TIMEOUT_MS \(/);
});

test("configFor gives a module its own checked config", async () => {
  const { values } = loadModuleConfigs([events], {
    EVENTS_ICS_URL: "https://cal.example/feed.ics",
  });
  const deps = { ...testDeps({} as never), moduleConfig: values };
  const config = configFor(deps, events);
  expect(config.TIMEOUT_MS).toBe(5000);
  expect(() => configFor(deps, plain)).toThrow(/declares no config/);
});
