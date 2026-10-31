import { router } from "@dlh/server";
import { authRouter } from "./routers/auth";
import { devicesRouter } from "./routers/devices";

export const appRouter = router({ auth: authRouter, devices: devicesRouter });
export type AppRouter = typeof appRouter;
