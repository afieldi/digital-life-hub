import { defineModule } from "@dlh/core";
import { createRoute } from "@tanstack/react-router";
import { tasksAiActions } from "./ai";
import { taskOps } from "./operations";
import { DetailRoute } from "./screens/DetailRoute";
import { DonePage } from "./screens/DonePage";
import { parseListSearch } from "./screens/lastList";
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
      validateSearch: parseListSearch,
      component: OpenPage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/tasks/upcoming",
      validateSearch: parseListSearch,
      component: UpcomingPage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/tasks/done",
      validateSearch: parseListSearch,
      component: DonePage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/tasks/$id",
      component: DetailRoute,
    }),
  ],
  operations: Object.values(taskOps),
  aiActions: Object.values(tasksAiActions),
});
