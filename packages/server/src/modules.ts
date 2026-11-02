import type { AiActionDescription } from "@dlh/core";
import type { AnyRouter } from "@trpc/server";
import {
  type AiRunner,
  checkModuleAction,
  collectAiRunners,
} from "./ai/runners";
import type { ItemWriter } from "./items/writer";
import type { ImplementedOperation, Operations } from "./operations/implement";
import { operationsRouter } from "./operations/router";
import type { DeleteWith } from "./trpc";

export const CORE_ROUTER_IDS = [
  "auth",
  "devices",
  "items",
  "links",
  "search",
  "recents",
  "ai",
  "ops",
] as const;

/** A module's endpoints come from `router` or, in its place, `operations`. */
export type ServerModule<
  Id extends string = string,
  R extends AnyRouter = AnyRouter,
  Ops extends Operations = Operations,
> = {
  id: Id;
  itemTypes: string[];
  router?: R;
  /** Each becomes a procedure `<id>.<key>`; the operation's id must be that path. */
  operations?: Ops;
  /** The module has migrations in `modules/<id>/drizzle`, applied after Core's. */
  migrations?: true;
  seed?: (w: ItemWriter) => Promise<void>;
  aiActions?: AiActionDescription[];
  aiRunners?: AiRunner[];
  /** Items to delete or restore together with an item of this module's types. */
  deleteWith?: DeleteWith;
};

export class ServerModuleError extends Error {
  override name = "ServerModuleError";
}

export function defineServerModule<
  const Id extends string,
  R extends AnyRouter,
>(
  m: ServerModule<Id, R> & { router: R; operations?: undefined },
): ServerModule<Id, R> & { router: R };
export function defineServerModule<
  const Id extends string,
  Ops extends Operations,
>(
  m: ServerModule<Id, AnyRouter, Ops> & { operations: Ops; router?: undefined },
): ServerModule<Id, AnyRouter, Ops> & { operations: Ops };
export function defineServerModule(m: ServerModule): ServerModule {
  return m;
}

/** The router mounted under the module's id. */
export function moduleRouter(m: ServerModule): AnyRouter {
  if (m.router) return m.router;
  if (m.operations) return operationsRouter(m.operations);
  throw new ServerModuleError(
    `Module "${m.id}" has neither a router nor operations`,
  );
}

export function collectServerModules(
  mods: ServerModule[],
  reservedIds: string[],
  core: { actions: AiActionDescription[]; runners: AiRunner[] },
): {
  modules: ServerModule[];
  itemTypes: Set<string>;
  aiRunners: Map<string, AiRunner>;
  deleteWith: Map<string, DeleteWith>;
  operations: Map<string, ImplementedOperation>;
} {
  const ids = new Set<string>();
  const owners = new Map<string, string>();
  const moduleOf = new Map<string, string>();
  const descriptions = [...core.actions];
  const runners = [...core.runners];
  const deleteWith = new Map<string, DeleteWith>();
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
    if (!m.router && !m.operations) {
      throw new ServerModuleError(
        `Module "${m.id}" has neither a router nor operations`,
      );
    }
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
      if (m.deleteWith) deleteWith.set(type, m.deleteWith);
    }
  }
  const aiRunners = collectAiRunners(descriptions, runners, moduleOf, owners);
  // Ids are `<module>.<key>`, so with unique module ids none can repeat.
  const operations = new Map<string, ImplementedOperation>();
  for (const m of mods) {
    for (const [key, op] of Object.entries(m.operations ?? {})) {
      checkModuleAction("Operation", op.desc, m.id, owners);
      if (op.desc.id !== `${m.id}.${key}`) {
        throw new ServerModuleError(
          `Operation "${op.desc.id}" is mounted as "${m.id}.${key}"`,
        );
      }
      operations.set(op.desc.id, op);
    }
  }
  return {
    modules: mods,
    itemTypes: new Set(owners.keys()),
    aiRunners,
    deleteWith,
    operations,
  };
}
