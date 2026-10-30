import { Inbox } from "lucide-react";
import { useState } from "react";
import { Chip } from "../../dusk/Chip";
import { TypeTile } from "../../dusk/TypeTile";
import { Board, type BoardColumnDef } from "../../patterns/Board";
import { CommandBar, type CommandGroup } from "../../patterns/CommandBar";
import { EmptyState } from "../../patterns/EmptyState";
import { ItemRow } from "../../patterns/ItemRow";
import { SectionCard } from "../../patterns/SectionCard";
import { Button } from "../../primitives/Button";
import { Checkbox } from "../../primitives/Checkbox";
import { statusColors, typeColors } from "../../tokens";
import { registerStories } from "../registry";
import { OverlayBox } from "./OverlayBox";

const noop = () => {};

type Card = {
  id: string;
  title: string;
  tag: string;
  due?: string;
  col: string;
};

const columns: BoardColumnDef[] = [
  { id: "todo", title: "To do", dot: "var(--color-ink-muted)" },
  { id: "in_progress", title: "In progress", dot: statusColors.in_progress },
  { id: "review", title: "Review", dot: statusColors.review },
  { id: "done", title: "Done", dot: typeColors.task },
];

const websiteRelaunch: Card[] = [
  {
    id: "t1",
    title: "Write homepage copy",
    tag: "Content",
    due: "Fri",
    col: "todo",
  },
  { id: "t2", title: "Pick a font pairing", tag: "Design", col: "todo" },
  {
    id: "t3",
    title: "Set up redirects",
    tag: "Dev",
    due: "Nov 8",
    col: "todo",
  },
  {
    id: "p1",
    title: "Build the hero section",
    tag: "Dev",
    due: "Today",
    col: "in_progress",
  },
  {
    id: "p2",
    title: "Photo shoot shortlist",
    tag: "Design",
    col: "in_progress",
  },
  {
    id: "r1",
    title: "About page draft",
    tag: "Content",
    due: "Mon",
    col: "review",
  },
  { id: "r2", title: "Accessibility pass", tag: "Dev", col: "review" },
  { id: "d1", title: "Sitemap", tag: "Content", col: "done" },
  { id: "d2", title: "Moodboard", tag: "Design", col: "done" },
];

function CardBody({ card }: { card: Card }) {
  const done = card.col === "done";
  return (
    <>
      <span
        className={`text-[15px] font-medium ${done ? "text-ink-muted line-through" : ""}`}
      >
        {card.title}
      </span>
      <span className="flex items-center gap-2 text-xs text-ink-tertiary">
        <span className="rounded-full bg-white/10 px-2 py-0.5">{card.tag}</span>
        {card.due ? <span>{card.due}</span> : null}
      </span>
    </>
  );
}

function BoardDemo() {
  const [cards, setCards] = useState(websiteRelaunch);
  const onMove = (id: string, to: string, index: number) =>
    setCards((all) => {
      const card = all.find((c) => c.id === id);
      if (!card) return all;
      const rest = all.filter((c) => c.id !== id);
      const inTarget = rest.filter((c) => c.col === to);
      const before = inTarget[index];
      const at = before ? rest.indexOf(before) : rest.length;
      rest.splice(at, 0, { ...card, col: to });
      return rest;
    });
  return (
    <Board
      columns={columns}
      items={cards}
      columnOf={(c) => c.col}
      renderCard={(c) => <CardBody card={c} />}
      textValue={(c) => c.title}
      onMove={onMove}
      onAdd={noop}
    />
  );
}

const populated: CommandGroup[] = [
  {
    id: "jump",
    label: "Jump to",
    items: [
      {
        id: "j1",
        label: "Website relaunch",
        hint: "Project",
        icon: <TypeTile type="project" size={30} />,
        onAction: noop,
      },
      {
        id: "j2",
        label: "Web fonts shortlist",
        hint: "Note",
        icon: <TypeTile type="note" size={30} />,
        onAction: noop,
      },
    ],
  },
  {
    id: "create",
    label: "Create",
    items: [
      {
        id: "c1",
        label: "New task “web”",
        icon: <TypeTile type="task" size={30} />,
        onAction: noop,
      },
      {
        id: "c2",
        label: "New note “web”",
        icon: <TypeTile type="note" size={30} />,
        onAction: noop,
      },
    ],
  },
  {
    id: "ai",
    label: "Ask AI",
    items: [
      {
        id: "a1",
        label: "Summarise what’s left on Website relaunch",
        icon: <TypeTile type="ai" size={30} />,
        onAction: noop,
      },
    ],
  },
];

function CommandBarDemo({
  initial,
  groups,
}: {
  initial: string;
  groups: CommandGroup[];
}) {
  const [query, setQuery] = useState(initial);
  return (
    <OverlayBox width={760} height={groups.length ? 680 : 340}>
      {(c) => (
        <CommandBar
          isOpen
          onOpenChange={noop}
          query={query}
          onQueryChange={setQuery}
          groups={groups}
          portalContainer={c}
          contained
        />
      )}
    </OverlayBox>
  );
}

const row = (
  props: Partial<Parameters<typeof ItemRow>[0]> & { title: string },
) => (
  <div className="w-[420px]">
    <ItemRow
      leading={
        <Checkbox
          aria-label={`Complete ${props.title}`}
          isSelected={!!props.done}
        />
      }
      {...props}
    />
  </div>
);

registerStories("patterns", [
  {
    id: "patterns/board",
    title: "Board (Website relaunch)",
    render: () => <BoardDemo />,
  },
  {
    id: "patterns/command-bar-empty",
    title: "Command bar (empty)",
    render: () => <CommandBarDemo initial="" groups={[]} />,
  },
  {
    id: "patterns/command-bar",
    title: "Command bar (populated)",
    render: () => <CommandBarDemo initial="web" groups={populated} />,
  },
  {
    id: "patterns/item-row",
    title: "Item row",
    render: () =>
      row({ title: "Draft Q4 budget", meta: "Due Friday", href: "#" }),
  },
  {
    id: "patterns/item-row-done",
    title: "Item row (done)",
    render: () => row({ title: "Book flights", meta: "Yesterday", done: true }),
  },
  {
    id: "patterns/item-row-chips",
    title: "Item row (chips)",
    render: () =>
      row({
        title: "Build the hero section",
        meta: "Today",
        href: "#",
        chips: (
          <>
            <Chip kind="project" color={typeColors.project}>
              Website relaunch
            </Chip>
            <Chip kind="status" status="in_progress" />
          </>
        ),
        trailing: "2h",
      }),
  },
  {
    id: "patterns/section-card",
    title: "Section card",
    render: () => (
      <div className="w-[460px]">
        <SectionCard
          title="Today’s focus"
          action={{ label: "All tasks", href: "#" }}
        >
          <div className="flex flex-col">
            <ItemRow
              leading={<Checkbox aria-label="Complete Draft Q4 budget" />}
              title="Draft Q4 budget"
              meta="Due today"
            />
            <ItemRow
              leading={
                <Checkbox aria-label="Complete Call the bank" isSelected />
              }
              title="Call the bank"
              meta="Done 9:40"
              done
            />
          </div>
        </SectionCard>
      </div>
    ),
  },
  {
    id: "patterns/empty-state",
    title: "Empty state",
    render: () => (
      <div className="glass-panel w-[420px]">
        <EmptyState
          icon={Inbox}
          title="Nothing here yet"
          body="Tasks you add will show up here."
          action={<Button variant="solid">Add a task</Button>}
        />
      </div>
    ),
  },
]);
