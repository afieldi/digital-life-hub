import { composeServer, router } from "@dlh/server";
import { serverModules } from "./modules.gen";
import { authRouter } from "./routers/auth";
import { devicesRouter } from "./routers/devices";

/**
 * What the API derives from its modules: the CoreDeps fields and the routers.
 * Throws on a duplicate module id or item type, or an id that clashes with a
 * core router.
 */
export const composed = composeServer(serverModules);

export const appRouter = router({
  auth: authRouter,
  devices: devicesRouter,
  ...composed.routers,
});
export type AppRouter = typeof appRouter;
