import { CalendarDays, Home, ListChecks, Plus, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Breadcrumb } from "../../dusk/Breadcrumb";
import { Chip } from "../../dusk/Chip";
import { Dock } from "../../dusk/Dock";
import { Kbd } from "../../dusk/Kbd";
import { ProgressBar } from "../../dusk/ProgressBar";
import { TypeTile } from "../../dusk/TypeTile";
import { Button } from "../../primitives/Button";
import type { ItemType } from "../../tokens";
import { registerStories } from "../registry";

const types: ItemType[] = ["task", "note", "project", "event", "ai"];

const dockItems = [
  { id: "home", label: "Home", icon: Home, href: "/" },
  { id: "tasks", label: "Tasks", icon: ListChecks, href: "/tasks" },
  { id: "calendar", label: "Calendar", icon: CalendarDays, href: "/calendar" },
  { id: "ai", label: "Assistant", icon: Sparkles, href: "/ai" },
];

// Dock is position:fixed in the app. In a story it gets className="absolute"
// and lives in a transformed, relatively-positioned box, so it is captured
// inside [data-story] instead of at the viewport bottom.
function DockBox({ children }: { children: ReactNode }) {
  return (
    <div
      style={{ transform: "translateZ(0)" }}
      className="relative h-[120px] w-[480px] overflow-hidden rounded-18"
    >
      {children}
    </div>
  );
}

const dock = (
  <Dock
    className="absolute"
    items={dockItems}
    currentHref="/tasks"
    trailing={
      <Button variant="icon" aria-label="Quick add">
        <Plus size={20} aria-hidden="true" />
      </Button>
    }
  />
);

registerStories("dusk", [
  {
    id: "dusk/type-tiles",
    title: "Type tiles",
    render: () => (
      <div className="flex items-center gap-4 p-4">
        {types.map((t) => (
          <TypeTile key={t} type={t} />
        ))}
        <TypeTile type="task" size={30} />
        <TypeTile type="task" size={36} />
      </div>
    ),
  },
  {
    id: "dusk/chips",
    title: "Chips",
    render: () => (
      <div className="flex flex-wrap items-center gap-3 p-4">
        <Chip kind="project" color="#9EC2FF">
          Website relaunch
        </Chip>
        <Chip kind="status" status="in_progress" />
        <Chip kind="status" status="review" />
        <Chip kind="type" color="#9FD9A8">
          Task
        </Chip>
        <Chip kind="type" color="#CDB6FF">
          AI
        </Chip>
      </div>
    ),
  },
  {
    id: "dusk/chip-link",
    title: "Linked chips",
    render: () => (
      <div className="flex items-center gap-3 p-4">
        <Chip kind="project" color="#9EC2FF" href="/projects/website">
          Website relaunch
        </Chip>
        <Chip kind="status" status="review" href="/tasks?status=review" />
        <Chip kind="type" color="#9FD9A8" href="/tasks">
          Task
        </Chip>
      </div>
    ),
  },
  {
    id: "dusk/chip-link-focus",
    title: "Linked chip focus",
    render: () => (
      <div className="flex items-center gap-3 p-4">
        <span data-force-focus>
          <Chip kind="project" color="#9EC2FF" href="/projects/website">
            Website relaunch
          </Chip>
        </span>
      </div>
    ),
  },
  {
    id: "dusk/chip-link-hover",
    title: "Linked chip hover",
    render: () => (
      <div className="flex items-center gap-3 p-4">
        <span data-force-hover>
          <Chip kind="project" color="#9EC2FF" href="/projects/website">
            Website relaunch
          </Chip>
        </span>
      </div>
    ),
  },
  {
    id: "dusk/kbd",
    title: "Kbd macOS and Windows",
    render: () => (
      <div className="flex items-center gap-4 p-4">
        <Kbd keys={["mod", "K"]} platform="MacIntel" />
        <Kbd keys={["mod", "K"]} platform="Win32" />
      </div>
    ),
  },
  {
    id: "dusk/progress",
    title: "Progress bar",
    render: () => (
      <div className="flex w-[320px] flex-col gap-4 p-4">
        <ProgressBar value={0} max={9} label="Not started" />
        <ProgressBar value={2} max={9} label="Website relaunch" />
        <ProgressBar value={9} max={9} label="Finished" />
      </div>
    ),
  },
  {
    id: "dusk/breadcrumb",
    title: "Breadcrumb",
    render: () => (
      <div className="p-4">
        <Breadcrumb
          items={[
            { label: "Home", href: "/" },
            { label: "Projects", href: "/projects" },
            { label: "Website relaunch" },
          ]}
        />
      </div>
    ),
  },
  {
    id: "dusk/dock",
    title: "Dock",
    render: () => <DockBox>{dock}</DockBox>,
  },
  {
    id: "dusk/dock-focus",
    title: "Dock focus",
    render: () => (
      <span data-force-focus>
        <DockBox>{dock}</DockBox>
      </span>
    ),
  },
  {
    id: "dusk/dock-hover",
    title: "Dock hover",
    render: () => (
      <span data-force-hover>
        <DockBox>{dock}</DockBox>
      </span>
    ),
  },
]);
