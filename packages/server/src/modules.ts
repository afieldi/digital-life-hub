import type { AnyRouter } from "@trpc/server";
import type { ItemWriter } from "./items/writer";

export const CORE_ROUTER_IDS = [
  "auth",
  "devices",
  "items",
  "links",
  "search",
  "recents",
] as const;

export type ServerModule<
  Id extends string = string,
  R extends AnyRouter = AnyRouter,
> = {
  id: Id;
  itemTypes: string[];
  router: R;
  seed?: (w: ItemWriter) => Promise<void>;
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
): { modules: ServerModule[]; itemTypes: Set<string> } {
  const ids = new Set<string>();
  const owners = new Map<string, string>();
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
  return { modules: mods, itemTypes: new Set(owners.keys()) };
}
