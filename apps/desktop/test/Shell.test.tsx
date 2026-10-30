import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../src/App";
import { createAppRouter } from "../src/router";

test("Dock is built from module manifests and the sample page loads", async () => {
  const router = createAppRouter(
    createMemoryHistory({ initialEntries: ["/"] }),
  );
  render(<App router={router} />);
  const dock = await screen.findByRole("navigation", { name: "Primary" });
  const link = await screen.findByRole("link", { name: "Sample" });
  expect(dock).toContainElement(link);
  await userEvent.click(link);
  expect(
    await screen.findByRole("heading", { level: 1, name: "Sample" }),
  ).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/sample");
});
