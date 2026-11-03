import type { ModuleRegistry } from "@dlh/core";
import {
  createRootRoute,
  createRoute,
  createRouter,
  type RouterHistory,
} from "@tanstack/react-router";
import { createElement } from "react";
import { registry as appRegistry, RegistryContext } from "./modules";
import { DevUi } from "./routes/DevUi";
import { Settings } from "./routes/Settings";
import { Shell } from "./shell/Shell";

/** The app's routes: the shell's own and each module's from `registry`. */
export function createAppRouter(
  history?: RouterHistory,
  registry: ModuleRegistry = appRegistry,
) {
  const rootRoute = createRootRoute({
    component: () =>
      createElement(
        RegistryContext.Provider,
        { value: registry },
        createElement(Shell),
      ),
  });
  const routeTree = rootRoute.addChildren([
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
