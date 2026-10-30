import { authRouter } from "./routers/auth";
import { devicesRouter } from "./routers/devices";
import { router } from "./trpc";

export const appRouter = router({ auth: authRouter, devices: devicesRouter });
export type AppRouter = typeof appRouter;
