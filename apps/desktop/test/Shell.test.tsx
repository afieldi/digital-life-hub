import { useQueryClient } from "@tanstack/react-query";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signedInApp } from "./apiHarness";

// Give the sample module's nav entry a badge that needs the query provider, to
// prove the shell renders badges inside it.
vi.mock("../src/modules", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/modules")>();
  const entry = actual.registry.nav.find((n) => n.path === "/sample");
  if (entry) {
    entry.badge = function SampleBadge() {
      useQueryClient();
      return <span>4</span>;
    };
  }
  return actual;
});

test("Dock is built from module manifests and the sample page loads", async () => {
  const { renderApp, router } = await signedInApp("/");
  renderApp();
  const dock = await screen.findByRole("navigation", { name: "Primary" });
  const link = await screen.findByRole("link", { name: /^Sample/ });
  expect(dock).toContainElement(link);
  await userEvent.click(link);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Sample" }),
  ).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/sample");
});

test("the shell renders a module's nav badge", async () => {
  const { renderApp } = await signedInApp("/");
  renderApp();
  expect(
    await screen.findByRole("link", { name: "Sample 4" }),
  ).toBeInTheDocument();
});
