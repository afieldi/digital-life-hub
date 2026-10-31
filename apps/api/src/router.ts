import { coreRouters, router } from "@dlh/server";
import { authRouter } from "./routers/auth";
import { devicesRouter } from "./routers/devices";

// Filled by the generated module list in a later task.
const moduleRouters = {};

export const appRouter = router({
  auth: authRouter,
  devices: devicesRouter,
  ...coreRouters,
  ...moduleRouters,
});
export type AppRouter = typeof appRouter;
