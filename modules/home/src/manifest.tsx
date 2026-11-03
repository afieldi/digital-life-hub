import { defineModule } from "@dlh/core";
import { createRoute } from "@tanstack/react-router";
import { HomePage } from "./HomePage";

/** Home: the greeting, then the panels other modules declare as `homeWidgets`. */
export default defineModule({
  id: "home",
  nav: { label: "Home", icon: "House", path: "/", order: 0, key: "h" },
  routes: (parent) => [
    createRoute({
      getParentRoute: () => parent,
      path: "/",
      component: HomePage,
    }),
  ],
});
