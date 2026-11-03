import { defineModule } from "@dlh/core";
import { createRoute } from "@tanstack/react-router";
import { requestOps } from "./operations";
import { DetailRoute } from "./screens/DetailRoute";
import { NeedsYou } from "./screens/NeedsYou";
import { OpenCount } from "./screens/OpenCount";
import { OpenPage } from "./screens/OpenPage";
import { parseQueueSearch } from "./screens/QueueHeader";
import { ResolvedPage } from "./screens/ResolvedPage";

export default defineModule({
  id: "requests",
  itemType: {
    type: "request",
    label: "Request",
    glyph: "Inbox",
    color: "var(--color-type-request)",
    href: (id) => `/queue/${id}`,
  },
  nav: {
    label: "Queue",
    icon: "Inbox",
    path: "/queue",
    order: 15,
    key: "q",
    badge: OpenCount,
  },
  routes: (parent) => [
    createRoute({
      getParentRoute: () => parent,
      path: "/queue",
      component: OpenPage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/queue/resolved",
      validateSearch: parseQueueSearch,
      component: ResolvedPage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/queue/$id",
      component: DetailRoute,
    }),
  ],
  homeWidgets: [{ id: "needsYou", label: "Needs you", component: NeedsYou }],
  operations: Object.values(requestOps),
});
