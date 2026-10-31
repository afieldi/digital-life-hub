import { coreRouters, router } from "@dlh/server";
import { serverModules } from "./modules.gen";
import { authRouter } from "./routers/auth";
import { devicesRouter } from "./routers/devices";

type ModuleRouters = {
  [M in (typeof serverModules)[number] as M["id"]]: M["router"];
};

// Each module's router is mounted under its id (`sample.create`).
const moduleRouters = Object.fromEntries(
  serverModules.map((m) => [m.id, m.router]),
) as ModuleRouters;

export const appRouter = router({
  auth: authRouter,
  devices: devicesRouter,
  ...coreRouters,
  ...moduleRouters,
});
export type AppRouter = typeof appRouter;
