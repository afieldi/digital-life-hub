import { composeServer, router, type ServerModule } from "@dlh/server";
import { serverModules } from "./modules.gen";
import { authRouter } from "./routers/auth";
import { devicesRouter } from "./routers/devices";

/**
 * What the API derives from `mods` (the CoreDeps fields) and its router: auth,
 * devices, Core's routers and each module's. Throws on a duplicate module id
 * or item type, or an id that clashes with a core router.
 */
export function composeApi<const Mods extends readonly ServerModule[]>(
  mods: Mods,
) {
  const composed = composeServer(mods);
  return {
    composed,
    router: router({
      auth: authRouter,
      devices: devicesRouter,
      ...composed.routers,
    }),
  };
}

const api = composeApi(serverModules);
export const composed = api.composed;
export const appRouter = api.router;
export type AppRouter = typeof appRouter;
