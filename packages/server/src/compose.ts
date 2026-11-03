import type { Db } from "@dlh/db";
import { coreAi } from "./ai/core-runners";
import type { AiDeps } from "./ai/gateway";
import { createChangeBus } from "./changes";
import {
  CORE_ROUTER_IDS,
  collectServerModules,
  moduleRouter,
  type ServerModule,
} from "./modules";
import type { Operations } from "./operations/implement";
import type { OperationsRouter } from "./operations/router";
import { coreRouters } from "./routers";
import type { CoreDeps } from "./trpc";

/** The router type of a module: its operations router when it has `operations`. */
export type ModuleRouterOf<M> = M extends {
  operations: infer T extends Operations;
}
  ? OperationsRouter<T>
  : M extends { router: infer R }
    ? R
    : never;

export type ModuleRouters<Mods extends readonly ServerModule[]> = {
  [M in Mods[number] as M["id"]]: ModuleRouterOf<M>;
};

/** Each module's router mounted under its id (`tasks.create`). */
export function mountModules<const Mods extends readonly ServerModule[]>(
  mods: Mods,
): ModuleRouters<Mods> {
  return Object.fromEntries(
    mods.map((m) => [m.id, moduleRouter(m)]),
  ) as ModuleRouters<Mods>;
}

/**
 * Everything the server derives from its modules: the CoreDeps fields
 * (item types, deleteWith, operations, AI runners) and the routers to mount,
 * Core's and each module's. Throws on a duplicate id or item type, or an id
 * that clashes with a core router.
 */
export function composeServer<const Mods extends readonly ServerModule[]>(
  mods: Mods,
) {
  const { itemTypes, deleteWith, operations, aiRunners } = collectServerModules(
    [...mods],
    [...CORE_ROUTER_IDS],
    coreAi,
  );
  return {
    itemTypes,
    deleteWith,
    operations,
    aiRunners,
    routers: { ...coreRouters, ...mountModules(mods) },
  };
}

/**
 * CoreDeps for a process: the module-derived fields from `composeServer`, a
 * fresh change bus, and the AI runners with the given providers.
 */
export function createCoreDeps(
  composed: Omit<ReturnType<typeof composeServer>, "routers">,
  opts: {
    db: Db;
    now?: () => Date;
    devErrors?: boolean;
    ai?: Pick<AiDeps, "providers" | "defaultModel">;
    /** Each module's checked config (`loadModuleConfigs`). */
    moduleConfig?: ReadonlyMap<string, unknown>;
  },
): CoreDeps {
  return {
    db: opts.db,
    changes: createChangeBus(),
    itemTypes: composed.itemTypes,
    deleteWith: composed.deleteWith,
    operations: composed.operations,
    moduleConfig: opts.moduleConfig ?? new Map(),
    now: opts.now ?? (() => new Date()),
    devErrors: opts.devErrors ?? false,
    ai: {
      runners: composed.aiRunners,
      providers: opts.ai?.providers ?? {},
      defaultModel: opts.ai?.defaultModel ?? null,
    },
  };
}
