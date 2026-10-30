import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { signedInApp } from "./apiHarness";

test("Dock is built from module manifests and the sample page loads", async () => {
  const { renderApp, router } = await signedInApp("/");
  renderApp();
  const dock = await screen.findByRole("navigation", { name: "Primary" });
  const link = await screen.findByRole("link", { name: "Sample" });
  expect(dock).toContainElement(link);
  await userEvent.click(link);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Sample" }),
  ).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/sample");
});
