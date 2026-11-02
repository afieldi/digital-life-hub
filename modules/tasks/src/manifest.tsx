import { defineModule } from "@dlh/core";
import { createRoute } from "@tanstack/react-router";
import { taskOps } from "./operations";
import { OpenPage } from "./screens/OpenPage";

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
  ],
  operations: Object.values(taskOps),
});
