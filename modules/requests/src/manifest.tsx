import { defineModule } from "@dlh/core";
import { requestOps } from "./operations";

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
  },
  // Queue's screens come with its list and detail views.
  routes: () => [],
  operations: Object.values(requestOps),
});
