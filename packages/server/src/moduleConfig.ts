import type { z } from "zod";
import type { ServerModule } from "./modules";
import type { CoreDeps } from "./trpc";

/**
 * Settings or secrets a module reads from the API's environment: each key of
 * `schema` is the variable `<prefix><KEY>`, a string (use `z.coerce` for
 * numbers). The API checks them at start with its own.
 */
export type ModuleConfig<S extends z.ZodObject = z.ZodObject> = {
  /** E.g. `EVENTS_`: every variable the module reads starts with it. */
  prefix: string;
  schema: S;
};

/** The environment variables a module's config reads, as `.env` names them. */
export function moduleConfigKeys(config: ModuleConfig): string[] {
  return Object.keys(config.schema.shape).map((k) => `${config.prefix}${k}`);
}

/**
 * Every module's config read from `env`, and the variables missing or
 * invalid across all of them (as `NAME` or `NAME (why)`), so one error can
 * list everything to fix.
 */
export function loadModuleConfigs(
  modules: readonly ServerModule[],
  env: Record<string, string | undefined>,
): { values: Map<string, unknown>; missing: string[] } {
  const values = new Map<string, unknown>();
  const missing: string[] = [];
  for (const m of modules) {
    if (!m.config) continue;
    const { prefix, schema } = m.config;
    const raw = Object.fromEntries(
      Object.keys(schema.shape).map((k) => {
        const v = env[`${prefix}${k}`]?.trim();
        return [k, v === "" ? undefined : v];
      }),
    );
    const parsed = schema.safeParse(raw);
    if (parsed.success) {
      values.set(m.id, parsed.data);
      continue;
    }
    for (const issue of parsed.error.issues) {
      const name = `${prefix}${String(issue.path[0] ?? "")}`;
      missing.push(
        raw[String(issue.path[0])] === undefined
          ? name
          : `${name} (${issue.message})`,
      );
    }
  }
  return { values, missing };
}

/** A module's own config, as checked at start. */
export function configFor<S extends z.ZodObject>(
  deps: CoreDeps,
  module: { id: string; config?: ModuleConfig<S> },
): z.output<S> {
  if (!module.config) {
    throw new Error(`Module "${module.id}" declares no config`);
  }
  const value = deps.moduleConfig.get(module.id);
  if (value === undefined) {
    throw new Error(`Module "${module.id}"'s config was never loaded`);
  }
  return value as z.output<S>;
}
