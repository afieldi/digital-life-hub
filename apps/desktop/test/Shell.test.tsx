import { collectModules } from "@dlh/core";
import { useQueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { registry, SHELL_RESERVED } from "../src/modules";
import { createAppRouter } from "../src/router";
import { signedInApp } from "./apiHarness";
import { fixtureManifest } from "./fixture/manifest";

test("Dock is built from module manifests and a module's page loads", async () => {
  const { renderApp, router } = await signedInApp("/", { fixture: true });
  renderApp();
  const dock = await screen.findByRole("navigation", { name: "Primary" });
  const link = await screen.findByRole("link", { name: /^Fixture/ });
  expect(dock).toContainElement(link);
  await userEvent.click(link);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Fixture" }),
  ).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/fixture");
});

test("the shell renders a module's nav badge", async () => {
  // A badge that needs the query provider, to prove the shell renders badges inside it.
  const nav = fixtureManifest.nav;
  if (!nav) throw new Error("the fixture has a nav entry");
  const withBadge = collectModules(
    [
      ...registry.modules,
      {
        ...fixtureManifest,
        nav: {
          ...nav,
          badge: function FixtureBadge() {
            useQueryClient();
            return <span>4</span>;
          },
        },
      },
    ],
    SHELL_RESERVED,
  );
  const { renderApp } = await signedInApp("/", {
    fixture: true,
    createRouter: (history) => createAppRouter(history, withBadge),
  });
  renderApp();
  expect(
    await screen.findByRole("link", { name: "Fixture 4" }),
  ).toBeInTheDocument();
});

test("Home is a module: the Dock reaches it, and it shows modules' widgets", async () => {
  const { renderApp, router } = await signedInApp("/fixture", {
    fixture: true,
  });
  renderApp();
  await screen.findByRole("heading", { level: 1, name: "Fixture" });
  await userEvent.click(await screen.findByRole("link", { name: "Home" }));
  expect(router.state.location.pathname).toBe("/");
  expect(await screen.findByText("Fixture widget on Home")).toBeInTheDocument();
});
