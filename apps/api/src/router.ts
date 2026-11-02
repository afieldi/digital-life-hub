import {
  coreRouters,
  moduleRouter,
  type Operations,
  type OperationsRouter,
  router,
  type ServerModule,
} from "@dlh/server";
import { serverModules } from "./modules.gen";
import { authRouter } from "./routers/auth";
import { devicesRouter } from "./routers/devices";

/** The router type of a module: its operations router when it has `operations`. */
export type ModuleRouterOf<M> = M extends {
  operations: infer T extends Operations;
}
  ? OperationsRouter<T>
  : M extends { router: infer R }
    ? R
    : never;

type ModuleRouters<Mods extends readonly ServerModule[]> = {
  [M in Mods[number] as M["id"]]: ModuleRouterOf<M>;
};

/** Each module's router mounted under its id (`sample.create`). */
export function mountModules<const Mods extends readonly ServerModule[]>(
  mods: Mods,
): ModuleRouters<Mods> {
  return Object.fromEntries(
    mods.map((m) => [m.id, moduleRouter(m)]),
  ) as ModuleRouters<Mods>;
}

export const appRouter = router({
  auth: authRouter,
  devices: devicesRouter,
  ...coreRouters,
  ...mountModules(serverModules),
});
export type AppRouter = typeof appRouter;
