import { CalendarDays, Home, ListChecks, Plus, Sparkles } from "lucide-react";
import type { ReactNode } from "react";
import { Breadcrumb } from "../../dusk/Breadcrumb";
import { Chip } from "../../dusk/Chip";
import { DayBars } from "../../dusk/DayBars";
import { Dock } from "../../dusk/Dock";
import { Flag } from "../../dusk/Flag";
import { Kbd } from "../../dusk/Kbd";
import { KeyHints } from "../../dusk/KeyHints";
import { ProgressBar } from "../../dusk/ProgressBar";
import { TypeTile } from "../../dusk/TypeTile";
import { ViewTabs } from "../../dusk/ViewTabs";
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
    id: "dusk/chip-removable",
    title: "Removable chips",
    render: () => (
      <div className="flex items-center gap-3 p-4">
        <Chip
          kind="project"
          color="#9EC2FF"
          href="/tasks/q4"
          onRemove={() => {}}
          removeLabel="Remove from Q4 planning"
        >
          Q4 planning
        </Chip>
        <Chip kind="project" onRemove={() => {}} removeLabel="Remove Home">
          Home
        </Chip>
      </div>
    ),
  },
  {
    id: "dusk/view-tabs",
    title: "View tabs",
    render: () => (
      <div className="p-4">
        <ViewTabs
          label="Task views"
          tabs={[
            { label: "Open · 9", href: "/tasks" },
            { label: "Upcoming · 14", href: "/tasks/upcoming", current: true },
            { label: "Done", href: "/tasks/done" },
          ]}
        />
      </div>
    ),
  },
  {
    id: "dusk/day-bars",
    title: "Day bars",
    render: () => (
      <div className="w-[280px] p-4">
        <DayBars
          label="Tasks done per day"
          highlight={2}
          bars={[
            { label: "Mon", value: 2 },
            { label: "Tue", value: 3 },
            { label: "Wed", value: 1 },
            { label: "Thu", value: 0 },
            { label: "Fri", value: 0 },
            { label: "Sat", value: 0 },
            { label: "Sun", value: 0 },
          ]}
        />
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
    id: "dusk/key-hints",
    title: "Key hints",
    render: () => (
      <div className="p-4">
        <KeyHints
          platform="MacIntel"
          hints={[
            { keys: ["N"], label: "new task" },
            { keys: ["X"], label: "complete" },
            { keys: ["↵"], label: "open" },
          ]}
        />
      </div>
    ),
  },
  {
    id: "dusk/flag",
    title: "Flag",
    render: () => (
      <div className="p-4">
        <Flag>High</Flag>
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
    id: "dusk/dock-count",
    title: "Dock with a count",
    render: () => (
      <DockBox>
        <Dock
          className="absolute"
          currentHref="/tasks"
          items={dockItems.map((i) =>
            i.id === "tasks" ? { ...i, badge: "3" } : i,
          )}
        />
      </DockBox>
    ),
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
