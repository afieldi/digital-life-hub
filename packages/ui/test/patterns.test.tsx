import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Inbox } from "lucide-react";
import { RouterProvider } from "react-aria-components";
import { Board } from "../src/patterns/Board";
import { CommandBar, type CommandGroup } from "../src/patterns/CommandBar";
import { EmptyState } from "../src/patterns/EmptyState";
import { ItemRow } from "../src/patterns/ItemRow";
import { SectionCard } from "../src/patterns/SectionCard";
import { Button } from "../src/primitives/Button";

const noop = () => {};

test("CommandBar keeps group order and Enter runs the highlighted item", async () => {
  const run = vi.fn();
  render(
    <CommandBar
      isOpen
      onOpenChange={() => {}}
      query=""
      onQueryChange={() => {}}
      groups={[
        {
          id: "jump",
          label: "Jump to",
          items: [{ id: "j1", label: "Q4 planning", onAction: () => {} }],
        },
        {
          id: "create",
          label: "Create",
          items: [{ id: "c1", label: "New note", onAction: run }],
        },
      ]}
    />,
  );
  const create = screen.getByText("Create"),
    jump = screen.getByText("Jump to");
  expect(
    create.compareDocumentPosition(jump) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  await userEvent.keyboard("{Enter}");
  expect(run).toHaveBeenCalledOnce();
});

const fourGroups: (run: (id: string) => void) => CommandGroup[] = (run) => [
  {
    id: "jump",
    label: "Jump to",
    items: [{ id: "j1", label: "Q4 planning", onAction: () => run("j1") }],
  },
  { id: "actions", label: "Actions", items: [] },
  {
    id: "ai",
    label: "Ask AI",
    items: [{ id: "a1", label: "Summarise", onAction: () => run("a1") }],
  },
  {
    id: "create",
    label: "Create",
    items: [
      { id: "c1", label: "New note", onAction: () => run("c1") },
      { id: "c2", label: "New task", onAction: () => run("c2") },
    ],
  },
];

test("CommandBar: ↑↓ move across groups, Enter runs and closes, empty groups hidden", async () => {
  const run = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CommandBar
      isOpen
      onOpenChange={onOpenChange}
      query=""
      onQueryChange={noop}
      groups={fourGroups(run)}
    />,
  );
  expect(screen.queryByText("Actions")).not.toBeInTheDocument();
  const input = screen.getByRole("combobox");
  expect(input).toHaveFocus();
  // create(c1, c2) → ai(a1) → jump(j1)
  await userEvent.keyboard("{ArrowDown}{ArrowDown}");
  expect(input).toHaveAttribute(
    "aria-activedescendant",
    screen.getByRole("option", { name: /Summarise/ }).id,
  );
  await userEvent.keyboard("{ArrowDown}{ArrowUp}{ArrowUp}");
  expect(screen.getByRole("option", { name: /New task/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await userEvent.keyboard("{Enter}");
  expect(run).toHaveBeenCalledWith("c2");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("CommandBar scrolls the highlighted row into view", async () => {
  const scroll = vi.fn();
  const original = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = scroll;
  try {
    render(
      <CommandBar
        isOpen
        onOpenChange={noop}
        query=""
        onQueryChange={noop}
        groups={fourGroups(noop)}
      />,
    );
    scroll.mockClear();
    await userEvent.keyboard("{ArrowDown}");
    const second = screen.getByRole("option", { name: /New task/ });
    expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
    expect(scroll.mock.contexts.at(-1)).toBe(second);
  } finally {
    Element.prototype.scrollIntoView = original;
  }
});

test("CommandBar: typing reports the query and Escape closes", async () => {
  const onQueryChange = vi.fn();
  const onOpenChange = vi.fn();
  render(
    <CommandBar
      isOpen
      onOpenChange={onOpenChange}
      query=""
      onQueryChange={onQueryChange}
      groups={fourGroups(noop)}
      placeholder="Search or ask"
    />,
  );
  expect(screen.getByPlaceholderText("Search or ask")).toHaveFocus();
  await userEvent.keyboard("q");
  expect(onQueryChange).toHaveBeenCalledWith("q");
  await userEvent.keyboard("{Escape}");
  expect(onOpenChange).toHaveBeenCalledWith(false);
});

test("CommandBar: clicking a row runs it", async () => {
  const run = vi.fn();
  render(
    <CommandBar
      isOpen
      onOpenChange={noop}
      query=""
      onQueryChange={noop}
      groups={fourGroups(run)}
    />,
  );
  await userEvent.click(screen.getByRole("option", { name: /Q4 planning/ }));
  expect(run).toHaveBeenCalledWith("j1");
});

const bar = (groups: CommandGroup[], onOpenChange = noop) => (
  <CommandBar
    isOpen
    onOpenChange={onOpenChange}
    query=""
    onQueryChange={noop}
    groups={groups}
  />
);

test("CommandBar renders groups in ORDER: recent, goto, create, actions, ai, jump", () => {
  const item = (id: string) => ({ id, label: `Row ${id}`, onAction: noop });
  const labels = ["Jump", "AI", "Actions", "Create", "Go to", "Recents"];
  const ids = ["jump", "ai", "actions", "create", "goto", "recent"] as const;
  render(
    bar(ids.map((id, i) => ({ id, label: labels[i], items: [item(id)] }))),
  );
  const rows = screen.getAllByRole("option").map((o) => o.textContent);
  expect(rows).toEqual([
    "Row recent",
    "Row goto",
    "Row create",
    "Row actions",
    "Row ai",
    "Row jump",
  ]);
});

test("CommandBar: ArrowDown skips a disabled row", async () => {
  render(
    bar([
      {
        id: "goto",
        label: "Go to",
        items: [
          { id: "a", label: "Alpha", onAction: noop },
          { id: "b", label: "Beta", disabled: true, onAction: noop },
          { id: "c", label: "Gamma", onAction: noop },
        ],
      },
    ]),
  );
  expect(screen.getByRole("option", { name: /Beta/ })).toHaveAttribute(
    "aria-disabled",
    "true",
  );
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByRole("option", { name: /Gamma/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await userEvent.keyboard("{ArrowUp}");
  expect(screen.getByRole("option", { name: /Alpha/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
});

test("CommandBar: clicking a disabled row neither runs nor closes", async () => {
  const run = vi.fn();
  const onOpenChange = vi.fn();
  render(
    bar(
      [
        {
          id: "recent",
          label: "Recents",
          items: [
            { id: "d", label: "Disabled one", disabled: true, onAction: run },
          ],
        },
      ],
      onOpenChange,
    ),
  );
  await userEvent.click(screen.getByRole("option", { name: /Disabled one/ }));
  await userEvent.keyboard("{Enter}");
  expect(run).not.toHaveBeenCalled();
  expect(onOpenChange).not.toHaveBeenCalled();
});

test("CommandBar: an empty group with a message renders its label and message", () => {
  render(
    bar([
      { id: "jump", label: "Jump to", items: [], message: "No items match" },
    ]),
  );
  expect(screen.getByText("Jump to")).toBeInTheDocument();
  expect(screen.getByText("No items match")).toBeInTheDocument();
  expect(screen.queryByText(/No results/)).not.toBeInTheDocument();
  expect(screen.queryByText(/Start typing/)).not.toBeInTheDocument();
});

test("CommandBar: palette-wide empty text shows only when no group has items or a message", () => {
  const { rerender } = render(
    bar([{ id: "jump", label: "Jump to", items: [] }]),
  );
  expect(screen.getByText(/Start typing/)).toBeInTheDocument();
  expect(screen.queryByText("Jump to")).not.toBeInTheDocument();
  rerender(
    bar([
      {
        id: "jump",
        label: "Jump to",
        items: [],
        message: "Search unavailable",
      },
    ]),
  );
  expect(screen.queryByText(/Start typing/)).not.toBeInTheDocument();
});

test("ItemRow done state strikes the title", () => {
  render(<ItemRow title="Draft budget" done />);
  expect(screen.getByText("Draft budget")).toHaveStyle({
    textDecorationLine: "line-through",
  });
});

test("ItemRow: Tab reaches the leading control then the title link; Enter navigates", async () => {
  const navigate = vi.fn();
  render(
    <RouterProvider navigate={navigate}>
      <ItemRow
        leading={<input type="checkbox" aria-label="Done" />}
        title="Draft budget"
        href="/tasks/1"
        meta="Due Friday"
      />
    </RouterProvider>,
  );
  expect(screen.getByText("Draft budget")).not.toHaveStyle({
    textDecorationLine: "line-through",
  });
  expect(screen.getByText("Due Friday")).toBeInTheDocument();
  await userEvent.tab();
  expect(screen.getByRole("checkbox", { name: "Done" })).toHaveFocus();
  await userEvent.tab();
  expect(screen.getByRole("link", { name: "Draft budget" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(navigate).toHaveBeenCalledWith("/tasks/1", undefined);
});

test("SectionCard renders its action link", async () => {
  const navigate = vi.fn();
  render(
    <RouterProvider navigate={navigate}>
      <SectionCard
        title="Today's focus"
        action={{ label: "All tasks", href: "/tasks" }}
      >
        <p>Body</p>
      </SectionCard>
    </RouterProvider>,
  );
  expect(
    screen.getByRole("heading", { level: 2, name: "Today's focus" }),
  ).toBeInTheDocument();
  const link = screen.getByRole("link", { name: "All tasks" });
  expect(link).toHaveAttribute("href", "/tasks");
  await userEvent.tab();
  expect(link).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(navigate).toHaveBeenCalledWith("/tasks", undefined);
});

test("EmptyState shows title and action", async () => {
  const onPress = vi.fn();
  render(
    <EmptyState
      icon={Inbox}
      title="Nothing here yet"
      body="Tasks you add will show up here."
      action={<Button onPress={onPress}>Add a task</Button>}
    />,
  );
  expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
  expect(
    screen.getByText("Tasks you add will show up here."),
  ).toBeInTheDocument();
  await userEvent.tab();
  expect(screen.getByRole("button", { name: "Add a task" })).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(onPress).toHaveBeenCalledOnce();
});

type Card = { id: string; title: string; col: string };
const columns = [
  { id: "todo", title: "To do", dot: "#9EC2FF" },
  { id: "doing", title: "In progress", dot: "#F5CF7E" },
];
const cards: Card[] = [
  { id: "a", title: "Write copy", col: "todo" },
  { id: "b", title: "Pick fonts", col: "todo" },
  { id: "c", title: "Build hero", col: "doing" },
];

test("Board groups cards into column grids with counts", () => {
  render(
    <Board
      columns={columns}
      items={cards}
      columnOf={(c) => c.col}
      renderCard={(c) => c.title}
      textValue={(c) => c.title}
      onMove={noop}
    />,
  );
  // Keyboard drags start from each card's drag button (exercised in e2e).
  expect(
    screen.getByRole("button", { name: "Drag Write copy" }),
  ).toBeInTheDocument();
  const todo = screen.getByRole("grid", { name: "To do" });
  const doing = screen.getByRole("grid", { name: "In progress" });
  expect(within(todo).getAllByRole("row")).toHaveLength(2);
  expect(within(doing).getByText("Build hero")).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: /To do/ }).textContent).toContain(
    "2",
  );
});

test("Board: arrow keys move between cards; + Add card calls onAdd with the column", async () => {
  const onAdd = vi.fn();
  render(
    <Board
      columns={columns}
      items={cards}
      columnOf={(c) => c.col}
      renderCard={(c) => c.title}
      onMove={noop}
      onAdd={onAdd}
    />,
  );
  await userEvent.tab();
  const rows = within(screen.getByRole("grid", { name: "To do" })).getAllByRole(
    "row",
  );
  expect(rows[0]).toHaveFocus();
  await userEvent.keyboard("{ArrowDown}");
  expect(rows[1]).toHaveFocus();
  await userEvent.tab();
  const add = screen.getAllByRole("button", { name: /Add card/ })[0];
  expect(add).toHaveFocus();
  await userEvent.keyboard("{Enter}");
  expect(onAdd).toHaveBeenCalledWith("todo");
});

const slotBar = (extra: Partial<Parameters<typeof CommandBar>[0]> = {}) => (
  <CommandBar
    isOpen
    onOpenChange={() => {}}
    query=""
    onQueryChange={() => {}}
    groups={[
      {
        id: "create",
        label: "Create",
        items: [{ id: "c1", label: "New note", onAction: () => {} }],
      },
    ]}
    {...extra}
  />
);

test("CommandBar interpretation renders above the results", () => {
  render(slotBar({ interpretation: <div>Understood as: note</div> }));
  const interp = screen.getByText("Understood as: note");
  const list = screen.getByRole("listbox");
  expect(
    interp.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
});

test("CommandBar result replaces the results listbox", async () => {
  const run = vi.fn();
  render(
    slotBar({
      result: <p>The answer is 42</p>,
      groups: [
        {
          id: "create",
          label: "Create",
          items: [{ id: "c1", label: "New note", onAction: run }],
        },
      ],
    }),
  );
  expect(screen.getByText("The answer is 42")).toBeTruthy();
  expect(screen.queryByRole("listbox")).toBeNull();
  expect(screen.queryByText("New note")).toBeNull();
  expect(screen.getByRole("combobox").getAttribute("aria-expanded")).toBe(
    "false",
  );
  await userEvent.keyboard("{Enter}");
  expect(run).not.toHaveBeenCalled();
});

test("CommandBar onKeyDown returning true skips built-in handling", async () => {
  const run = vi.fn();
  const onKeyDown = vi.fn(() => true);
  render(
    slotBar({
      onKeyDown,
      groups: [
        {
          id: "create",
          label: "Create",
          items: [{ id: "c1", label: "New note", onAction: run }],
        },
      ],
    }),
  );
  await userEvent.keyboard("{Enter}");
  expect(onKeyDown).toHaveBeenCalled();
  expect(run).not.toHaveBeenCalled();
});

test("CommandBar announces results in a persistent live region", () => {
  const { rerender } = render(slotBar());
  const region = screen.getByRole("status");
  expect(region.textContent).toBe("");
  rerender(slotBar({ result: <p>The answer is 42</p> }));
  expect(screen.getByRole("status")).toBe(region);
  expect(region.textContent).toBe("The answer is 42");
});

test("CommandBar interpretation sits in a polite live region", () => {
  render(slotBar({ interpretation: <span>Understood as: note</span> }));
  const live = screen
    .getByText("Understood as: note")
    .closest("[aria-live='polite']");
  expect(live).not.toBeNull();
});

test("CommandBar drops dangling ARIA references in result mode", () => {
  const { rerender } = render(slotBar());
  const input = screen.getByRole("combobox");
  expect(input.getAttribute("aria-controls")).toBeTruthy();
  rerender(slotBar({ result: <p>Answer</p> }));
  expect(input.hasAttribute("aria-controls")).toBe(false);
  expect(input.hasAttribute("aria-activedescendant")).toBe(false);
});

test("CommandBar onKeyDown hook sees Tab and ArrowDown", async () => {
  const keys: string[] = [];
  render(
    slotBar({
      onKeyDown: (e) => {
        keys.push(e.key);
        return e.key === "ArrowDown";
      },
    }),
  );
  await userEvent.keyboard("{ArrowDown}");
  await userEvent.keyboard("{Tab}");
  expect(keys).toContain("ArrowDown");
  expect(keys).toContain("Tab");
});
