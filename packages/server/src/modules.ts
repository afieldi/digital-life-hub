import {
  type AiActionDescription,
  accessOf,
  type ModuleDescription,
  type OperationDescription,
  toAiAction,
} from "@dlh/core";
import type { AnyRouter } from "@trpc/server";
import { operationAiRunner } from "./ai/operation-runner";
import {
  type AiRunner,
  checkModuleAction,
  collectAiRunners,
} from "./ai/runners";
import type { ItemWriter } from "./items/writer";
import type { ModuleConfig } from "./moduleConfig";
import type { ImplementedOperation, Operations } from "./operations/implement";
import { operationsRouter } from "./operations/router";
import type { DeleteWith, RunGuard } from "./trpc";

/**
 * Calls an operation a run can call (`access: "everyone"`) may make to one
 * only you can call. A run guard checks the run's call, never what it reaches
 * with `w.call`, so each is listed here, `caller -> callee`, with why the
 * caller keeps it to what the run may reach. Composing refuses an entry that
 * isn't such a call, so the list can't go stale; an app test checks every
 * listed caller exists.
 */
export const UNGUARDED_CALLS: ReadonlySet<string> = new Set([
  // Both read only the run's own request: Core holds `runId` to the calling
  // run, and the request is the one `agent.runSource` names for it.
  "slack.postToSource -> agent.runSource",
  "slack.postToSource -> requests.get",
]);

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
  /** Settings or secrets from the API's environment; read them with `configFor`. */
  config?: ModuleConfig;
  /** Checks every call an agent run makes, to any module's operation (`RunGuard`). */
  runGuard?: RunGuard;
};

export class ServerModuleError extends Error {
  override name = "ServerModuleError";
}

/** The server-module fields a module's description supplies. */
type Described = "id" | "itemTypes" | "aiActions" | "operations" | "router";

/** One implementation per described operation, keyed the same, and no others. */
export type ImplementationsOf<
  Ops extends Record<string, OperationDescription>,
  Impls,
> = { [K in keyof Ops]: ImplementedOperation<Ops[K], unknown> } & Record<
  Exclude<keyof Impls, keyof Ops>,
  never
>;

/**
 * A module's server half. With a description, its id, item types and AI
 * actions come from it, and `operations` must implement exactly the
 * operations it describes (checked by type, and at load by identity). The
 * one-argument forms take a hand-built module, with `router` in place of
 * `operations` for raw tRPC procedures.
 */
export function defineServerModule<
  const Id extends string,
  Ops extends Record<string, OperationDescription>,
  Impls extends Operations,
>(
  desc: ModuleDescription<Id, Ops>,
  parts: Omit<ServerModule, Described> & {
    operations: Impls & ImplementationsOf<Ops, Impls>;
  },
): ServerModule<Id, AnyRouter, Impls> & { operations: Impls };
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
export function defineServerModule(
  a: ServerModule | ModuleDescription,
  parts?: Omit<ServerModule, Described> & { operations: Operations },
): ServerModule {
  // A description always comes with `parts`; a hand-built module never does.
  if (!parts) return a as ServerModule;
  const desc = a as ModuleDescription;
  const described = Object.keys(desc.operations).sort();
  const implemented = Object.keys(parts.operations).sort();
  if (described.join() !== implemented.join()) {
    throw new ServerModuleError(
      `Module "${desc.id}" implements ${JSON.stringify(implemented)} but describes ${JSON.stringify(described)}`,
    );
  }
  for (const [key, op] of Object.entries(parts.operations)) {
    if (op.desc !== desc.operations[key]) {
      throw new ServerModuleError(
        `Module "${desc.id}" implements "${key}" for another operation than it describes`,
      );
    }
  }
  return {
    ...parts,
    id: desc.id,
    itemTypes: [...desc.itemTypes],
    aiActions: [...desc.aiActions],
  };
}

/** The router mounted under the module's id. */
export function moduleRouter(m: ServerModule): AnyRouter {
  if (m.router) return m.router;
  if (m.operations) return operationsRouter(m.operations);
  throw new ServerModuleError(
    `Module "${m.id}" has neither a router nor operations`,
  );
}

/** Operations that are also AI actions (all but those with `ai: false`). */
function aiOperations(m: ServerModule): ImplementedOperation[] {
  return Object.values(m.operations ?? {}).filter((op) => op.desc.ai !== false);
}

/** The module's AI actions: its hand-written `aiActions`, then its operations'. */
export function moduleAiActions(m: ServerModule): AiActionDescription[] {
  return [
    ...(m.aiActions ?? []),
    ...aiOperations(m).map((op) => toAiAction(op.desc)),
  ];
}

export function collectServerModules(
  mods: ServerModule[],
  reservedIds: string[],
  core: { actions: AiActionDescription[]; runners: AiRunner[] },
  unguardedCalls: ReadonlySet<string> = UNGUARDED_CALLS,
): {
  modules: ServerModule[];
  itemTypes: Set<string>;
  aiRunners: Map<string, AiRunner>;
  deleteWith: Map<string, DeleteWith>;
  operations: Map<string, ImplementedOperation>;
  runGuards: RunGuard[];
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
    for (const a of moduleAiActions(m)) {
      moduleOf.set(a.id, m.id);
      descriptions.push(a);
    }
    runners.push(
      ...(m.aiRunners ?? []),
      ...aiOperations(m).map(operationAiRunner),
    );
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
  // Operations first, so a bad one is reported as an operation, not as the AI action it derives.
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
  // Calls last, once every operation is registered. One level deep: a callee has no calls.
  for (const op of operations.values()) {
    for (const callee of op.desc.calls ?? []) {
      const registered = operations.get(callee.id);
      if (!registered) {
        throw new ServerModuleError(
          `Operation "${op.desc.id}" calls "${callee.id}", which is not registered`,
        );
      }
      if (callee.id === op.desc.id) {
        throw new ServerModuleError(`Operation "${op.desc.id}" calls itself`);
      }
      if (registered.desc.calls?.length) {
        throw new ServerModuleError(
          `Operation "${op.desc.id}" calls "${callee.id}", which makes calls of its own`,
        );
      }
      if (
        accessOf(op.desc) === "everyone" &&
        accessOf(registered.desc) !== "everyone" &&
        !unguardedCalls.has(`${op.desc.id} -> ${callee.id}`)
      ) {
        throw new ServerModuleError(
          `Operation "${op.desc.id}" can be called by a run, so it may call only operations a run can call, but calls "${callee.id}". List it in UNGUARDED_CALLS if that is safe`,
        );
      }
    }
  }
  // A listed call must be one: a caller a run can call, calling one it can't.
  // A caller this composition lacks (a test's subset of modules) is skipped.
  for (const pair of unguardedCalls) {
    const [callerId = "", calleeId = ""] = pair.split(" -> ");
    const caller = operations.get(callerId);
    if (!caller) continue;
    const callee = operations.get(calleeId);
    const real =
      accessOf(caller.desc) === "everyone" &&
      (caller.desc.calls ?? []).some((c) => c.id === calleeId) &&
      callee !== undefined &&
      accessOf(callee.desc) !== "everyone";
    if (!real) {
      throw new ServerModuleError(
        `UNGUARDED_CALLS lists "${pair}", which is not a call a run could make unguarded: remove it`,
      );
    }
  }
  const aiRunners = collectAiRunners(descriptions, runners, moduleOf, owners);
  return {
    modules: mods,
    itemTypes: new Set(owners.keys()),
    aiRunners,
    deleteWith,
    operations,
    runGuards: mods.flatMap((m) => (m.runGuard ? [m.runGuard] : [])),
  };
}
