import { defineModule } from "@dlh/core";
import { toast } from "@dlh/ui";
import { createRoute } from "@tanstack/react-router";
import { SamplePage } from "./SamplePage";

/** Throwaway module: proves a manifest alone adds a Dock item, route and action. */
export default defineModule({
  id: "sample",
  nav: {
    label: "Sample",
    icon: "FlaskConical",
    path: "/sample",
    order: 99,
    key: "s",
  },
  routes: (parent) => [
    createRoute({
      getParentRoute: () => parent,
      path: "/sample",
      component: SamplePage,
    }),
  ],
  paletteActions: [
    {
      id: "sample.hello",
      label: "Hello from Sample",
      icon: "FlaskConical",
      group: "actions",
      run: () => toast("Hello from Sample"),
    },
  ],
});
