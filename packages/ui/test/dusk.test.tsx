import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home, ListChecks } from "lucide-react";
import { RouterProvider } from "react-aria-components";
import { Breadcrumb } from "../src/dusk/Breadcrumb";
import { Chip } from "../src/dusk/Chip";
import { Dock } from "../src/dusk/Dock";
import { Kbd } from "../src/dusk/Kbd";
import { ProgressBar } from "../src/dusk/ProgressBar";
import { TypeTile } from "../src/dusk/TypeTile";
import { modKeyLabel } from "../src/platform";

test("Kbd shows Ctrl on Windows and ⌘ on macOS", () => {
  expect(modKeyLabel("Win32")).toBe("Ctrl");
  expect(modKeyLabel("MacIntel")).toBe("⌘");
  render(<Kbd keys={["mod", "K"]} platform="Win32" />);
  expect(screen.getByText(/Ctrl/)).toBeInTheDocument();
});

test("Kbd shows ⌘K on macOS", () => {
  render(<Kbd keys={["mod", "K"]} platform="MacIntel" />);
  expect(screen.getByText("⌘K")).toBeInTheDocument();
});

test("Dock marks the current item", () => {
  render(
    <Dock
      currentHref="/tasks"
      items={[
        { id: "home", label: "Home", icon: Home, href: "/" },
        { id: "tasks", label: "Tasks", icon: ListChecks, href: "/tasks" },
      ]}
    />,
  );
  expect(screen.getByRole("link", { name: "Tasks" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
    "aria-current",
  );
});

test("status Chip labels its status", () => {
  render(<Chip kind="status" status="review" />);
  expect(screen.getByText("Review")).toBeInTheDocument();
});

test("ProgressBar exposes value and text", () => {
  render(<ProgressBar value={2} max={9} label="Website relaunch" />);
  const p = screen.getByRole("progressbar");
  expect(p).toHaveAttribute("aria-valuenow", "2");
  expect(screen.getByText("2 of 9 done")).toBeInTheDocument();
});

test("Breadcrumb marks the last item current", () => {
  render(
    <Breadcrumb
      items={[
        { label: "Home", href: "/" },
        { label: "Projects", href: "/projects" },
        { label: "Website relaunch" },
      ]}
    />,
  );
  expect(screen.getByText("Website relaunch")).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Home" })).not.toHaveAttribute(
    "aria-current",
  );
});

test("TypeTile uses the type colour", () => {
  render(<TypeTile type="note" />);
  expect(screen.getByTestId("type-tile")).toHaveStyle({
    backgroundColor: "#F5CF7E",
  });
});

const dockItems = [
  { id: "home", label: "Home", icon: Home, href: "/" },
  { id: "tasks", label: "Tasks", icon: ListChecks, href: "/tasks" },
];

test("Dock: Tab moves through the links then the trailing slot; Enter navigates", async () => {
  const navigate = vi.fn();
  render(
    <RouterProvider navigate={navigate}>
      <Dock
        currentHref="/"
        items={dockItems}
        trailing={<button type="button">Quick add</button>}
      />
    </RouterProvider>,
  );
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "Home" })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "Tasks" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(navigate).toHaveBeenCalledWith("/tasks", undefined);
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Quick add" })).toHaveFocus();
});

test("Breadcrumb: Enter on a link navigates; the current item is not focusable", async () => {
  const navigate = vi.fn();
  render(
    <RouterProvider navigate={navigate}>
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          { label: "Projects", href: "/projects" },
          { label: "Website relaunch" },
        ]}
      />
    </RouterProvider>,
  );
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "Home" })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "Projects" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(navigate).toHaveBeenCalledWith("/projects", undefined);
  await userEvent.tab();
  expect(screen.getByText("Website relaunch")).not.toHaveFocus();
  expect(document.body).toHaveFocus();
});

test("linked Chip is focusable and Enter follows it; unlinked Chip is not focusable", async () => {
  const navigate = vi.fn();
  render(
    <RouterProvider navigate={navigate}>
      <Chip kind="project" color="#9EC2FF">
        Plain
      </Chip>
      <Chip kind="project" color="#9EC2FF" href="/projects/web">
        Website
      </Chip>
    </RouterProvider>,
  );
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "Website" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(navigate).toHaveBeenCalledWith("/projects/web", undefined);
});
