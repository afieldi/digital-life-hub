import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { registry } from "./modules";
import { DevUi } from "./routes/DevUi";
import { Home } from "./routes/Home";
import { Settings } from "./routes/Settings";
import { Shell } from "./shell/Shell";

export function createAppRouter(history?: RouterHistory) {
  const rootRoute = createRootRoute({ component: Shell });
  const routeTree = rootRoute.addChildren([
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/",
      component: Home,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/settings",
      component: Settings,
    }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/dev/ui",
      component: DevUi,
    }),
    ...registry.modules.flatMap((m) => m.routes(rootRoute)),
  ]);
  return createRouter({ routeTree, history });
}

export type AppRouter = ReturnType<typeof createAppRouter>;
