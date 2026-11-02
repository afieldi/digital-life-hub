import { defineModule } from "@dlh/core";
import { createRoute } from "@tanstack/react-router";
import { taskOps } from "./operations";
import { DetailRoute } from "./screens/DetailRoute";
import { DonePage } from "./screens/DonePage";
import { OpenPage } from "./screens/OpenPage";
import { UpcomingPage } from "./screens/UpcomingPage";

export default defineModule({
  id: "tasks",
  itemType: {
    type: "task",
    label: "Task",
    glyph: "Check",
    color: "var(--color-type-task)",
    href: (id) => `/tasks/${id}`,
  },
  nav: {
    label: "Tasks",
    icon: "Check",
    path: "/tasks",
    order: 10,
    key: "t",
  },
  routes: (parent) => [
    createRoute({
      getParentRoute: () => parent,
      path: "/tasks",
      component: OpenPage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/tasks/upcoming",
      component: UpcomingPage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/tasks/done",
      component: DonePage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/tasks/$id",
      component: DetailRoute,
    }),
  ],
  operations: Object.values(taskOps),
});
