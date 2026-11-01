import type { AiActionDescription } from "@dlh/core";
import type { AnyRouter } from "@trpc/server";
import { type AiRunner, collectAiRunners } from "./ai/runners";
import type { ItemWriter } from "./items/writer";

export const CORE_ROUTER_IDS = [
  "auth",
  "devices",
  "items",
  "links",
  "search",
  "recents",
  "ai",
] as const;

export type ServerModule<
  Id extends string = string,
  R extends AnyRouter = AnyRouter,
> = {
  id: Id;
  itemTypes: string[];
  router: R;
  seed?: (w: ItemWriter) => Promise<void>;
  aiActions?: AiActionDescription[];
  aiRunners?: AiRunner[];
};

export class ServerModuleError extends Error {
  override name = "ServerModuleError";
}

export function defineServerModule<
  const Id extends string,
  R extends AnyRouter,
>(m: ServerModule<Id, R>): ServerModule<Id, R> {
  return m;
}

export function collectServerModules(
  mods: ServerModule[],
  reservedIds: string[],
  core: { actions: AiActionDescription[]; runners: AiRunner[] },
): {
  modules: ServerModule[];
  itemTypes: Set<string>;
  aiRunners: Map<string, AiRunner>;
} {
  const ids = new Set<string>();
  const owners = new Map<string, string>();
  const moduleOf = new Map<string, string>();
  const descriptions = [...core.actions];
  const runners = [...core.runners];
  for (const m of mods) {
    if (reservedIds.includes(m.id)) {
      throw new ServerModuleError(
        `Module id "${m.id}" clashes with a core router`,
      );
    }
    if (ids.has(m.id)) {
      throw new ServerModuleError(`Duplicate server module id "${m.id}"`);
    }
    ids.add(m.id);
    for (const a of m.aiActions ?? []) {
      moduleOf.set(a.id, m.id);
      descriptions.push(a);
    }
    runners.push(...(m.aiRunners ?? []));
    for (const type of m.itemTypes) {
      const owner = owners.get(type);
      if (owner !== undefined && owner !== m.id) {
        throw new ServerModuleError(
          `Item type "${type}" is claimed by modules "${owner}" and "${m.id}"`,
        );
      }
      owners.set(type, m.id);
    }
  }
  const aiRunners = collectAiRunners(descriptions, runners, moduleOf, owners);
  return { modules: mods, itemTypes: new Set(owners.keys()), aiRunners };
}
