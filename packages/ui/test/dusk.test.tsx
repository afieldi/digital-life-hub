import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Home, ListChecks, Puzzle } from "lucide-react";
import { RouterProvider } from "react-aria-components";
import { Breadcrumb } from "../src/dusk/Breadcrumb";
import { Chip } from "../src/dusk/Chip";
import { DayBars } from "../src/dusk/DayBars";
import { Dock } from "../src/dusk/Dock";
import { Flag } from "../src/dusk/Flag";
import { Kbd } from "../src/dusk/Kbd";
import { KeyHints } from "../src/dusk/KeyHints";
import { ProgressBar } from "../src/dusk/ProgressBar";
import { TypeTile } from "../src/dusk/TypeTile";
import { ViewTabs } from "../src/dusk/ViewTabs";
import { iconFor } from "../src/icons";
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

test("Dock renders an item's badge as part of the link name", () => {
  render(
    <Dock
      currentHref="/"
      items={[
        { id: "home", label: "Home", icon: Home, href: "/" },
        {
          id: "queue",
          label: "Queue",
          icon: ListChecks,
          href: "/queue",
          badge: <span>3</span>,
        },
      ]}
    />,
  );
  expect(screen.getByRole("link", { name: "Queue 3" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Home" })).toBeInTheDocument();
});

const Empty = () => null;

test("Dock: a badge that renders nothing leaves the link name as the label", () => {
  render(
    <Dock
      currentHref="/"
      items={[
        {
          id: "queue",
          label: "Queue",
          icon: ListChecks,
          href: "/queue",
          badge: <Empty />,
        },
      ]}
    />,
  );
  expect(screen.getByRole("link", { name: "Queue" })).toBeInTheDocument();
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

test("TypeTile shows the given colour and icon", () => {
  render(<TypeTile glyph="Pilcrow" color="#F5CF7E" />);
  const tile = screen.getByTestId("type-tile");
  expect(tile).toHaveStyle({ backgroundColor: "#F5CF7E" });
  expect(tile.querySelector("svg")).toHaveClass("lucide-pilcrow");
});

test("iconFor falls back to a puzzle piece for an unknown name", () => {
  expect(iconFor("NoSuchIcon")).toBe(Puzzle);
  expect(iconFor(undefined)).toBe(Puzzle);
  expect(iconFor("Check")).not.toBe(Puzzle);
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

test("Flag and KeyHints show their labels", () => {
  render(
    <>
      <Flag>High</Flag>
      <KeyHints
        hints={[
          { keys: ["N"], label: "new task" },
          { keys: ["X"], label: "complete" },
        ]}
      />
    </>,
  );
  expect(screen.getByText("High")).toBeInTheDocument();
  const list = screen.getByRole("list", { name: "Keyboard shortcuts" });
  expect(list).toHaveTextContent("Nnew task");
  expect(list).toHaveTextContent("Xcomplete");
});

test("ViewTabs are links in a named nav; the current one is the page", () => {
  render(
    <ViewTabs
      label="Task views"
      tabs={[
        { label: "Open · 2", href: "/tasks", current: true },
        { label: "Done", href: "/tasks/done" },
      ]}
    />,
  );
  const nav = screen.getByRole("navigation", { name: "Task views" });
  expect(nav).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open · 2" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(screen.getByRole("link", { name: "Done" })).not.toHaveAttribute(
    "aria-current",
  );
});

test("DayBars reads as one image listing every day", () => {
  render(
    <DayBars
      label="Tasks done per day"
      bars={[
        { label: "Mon", value: 2 },
        { label: "Tue", value: 0 },
      ]}
    />,
  );
  expect(
    screen.getByRole("img", { name: "Tasks done per day: Mon 2, Tue 0" }),
  ).toBeInTheDocument();
});

test("Chip with onRemove has a named × button", async () => {
  const onRemove = vi.fn();
  render(
    <Chip kind="project" onRemove={onRemove} removeLabel="Remove from Q4">
      Q4
    </Chip>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Remove from Q4" }));
  expect(onRemove).toHaveBeenCalledOnce();
});
