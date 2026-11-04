import { defineModule } from "@dlh/core";
import { fixtureOps } from "@dlh/core/fixture";
import { toast } from "@dlh/ui";
import { createRoute } from "@tanstack/react-router";
import { FixtureItemPage } from "./FixtureItemPage";
import { FixturePage } from "./FixturePage";

/**
 * The client half of `fixtureServer`, a test-only module: a Dock item and
 * route, an item page that records views and renames through Core, its
 * operation in ⌘K, and a palette action of its own.
 */
export const fixtureManifest = defineModule({
  id: "fixture",
  itemType: {
    type: "fixture",
    label: "Fixture",
    glyph: "FlaskConical",
    color: "var(--color-type-ai)",
    href: (id) => `/fixture/${id}`,
  },
  nav: {
    label: "Fixture",
    icon: "FlaskConical",
    path: "/fixture",
    order: 99,
    key: "f",
  },
  routes: (parent) => [
    createRoute({
      getParentRoute: () => parent,
      path: "/fixture",
      component: FixturePage,
    }),
    createRoute({
      getParentRoute: () => parent,
      path: "/fixture/$id",
      component: FixtureItemPage,
    }),
  ],
  operations: Object.values(fixtureOps),
  homeWidgets: [
    {
      id: "hello",
      label: "Fixture widget",
      component: () => <p>Fixture widget on Home</p>,
    },
  ],
  detailPanels: [
    {
      itemType: "task",
      id: "onTask",
      label: "Fixture panel",
      component: ({ itemId }) => <p>Fixture panel for {itemId}</p>,
    },
  ],
  paletteActions: [
    {
      id: "fixture.hello",
      label: "Hello from Fixture",
      icon: "FlaskConical",
      group: "actions",
      run: () => {
        toast("Hello from Fixture");
      },
    },
    {
      id: "fixture.whichItem",
      label: "Which item is this",
      group: "actions",
      when: (ctx) => ctx.itemId !== undefined,
      run: (ctx) => {
        toast(`On item ${ctx.itemId}`);
      },
    },
  ],
});
