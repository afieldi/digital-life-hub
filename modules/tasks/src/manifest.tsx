import { defineModule } from "@dlh/core";

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
  routes: () => [],
});
