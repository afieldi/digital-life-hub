import type { FieldSpec, ItemSummary } from "@dlh/core";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { DueField } from "../src/patterns/DueField";
import { OperationForm } from "../src/patterns/OperationForm";
import { SidePanel } from "../src/patterns/SidePanel";
import { SegmentedChoice } from "../src/primitives/SegmentedChoice";

const fields: FieldSpec[] = [
  {
    name: "title",
    label: "Title",
    kind: "text",
    optional: false,
    nullable: false,
  },
  {
    name: "notes",
    label: "Notes",
    kind: "longText",
    optional: true,
    nullable: true,
  },
  {
    name: "priority",
    label: "Priority",
    kind: "choice",
    optional: true,
    nullable: false,
    options: ["low", "medium", "high"],
  },
  {
    name: "status",
    label: "Status",
    kind: "choice",
    optional: true,
    nullable: false,
    options: ["a", "b", "c", "d", "e"],
  },
  {
    name: "pinned",
    label: "Pinned",
    kind: "switch",
    optional: true,
    nullable: false,
  },
  { name: "due", label: "Due", kind: "due", optional: true, nullable: true },
  {
    name: "parent",
    label: "Parent",
    kind: "item",
    optional: true,
    nullable: true,
    types: ["task"],
  },
];
const rows: ItemSummary[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    type: "task",
    title: "Write spec",
    archivedAt: null,
  },
];
const search = vi.fn(async (_q: string, _types: string[]) => rows);
const zone = "America/Los_Angeles";

function form(over: Partial<Parameters<typeof OperationForm>[0]> = {}) {
  const onSubmit = vi.fn();
  const onCancel = vi.fn();
  render(
    <OperationForm
      title="Add task"
      fields={fields}
      initial={{}}
      timeZone={zone}
      search={search}
      onSubmit={onSubmit}
      onCancel={onCancel}
      {...over}
    />,
  );
  return { onSubmit, onCancel };
}

test("OperationForm renders each field kind", () => {
  form();
  expect(screen.getByRole("dialog", { name: "Add task" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Title" })).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Notes" }).tagName).toBe(
    "TEXTAREA",
  );
  expect(
    screen.getByRole("radiogroup", { name: "Priority" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("radiogroup", { name: "Status" })).toBeNull();
  expect(screen.getByRole("button", { name: /Status/ })).toBeInTheDocument();
  expect(screen.getByRole("switch", { name: "Pinned" })).toBeInTheDocument();
  expect(screen.getByRole("group", { name: "Due" })).toBeInTheDocument();
  expect(screen.getByRole("combobox", { name: "Parent" })).toBeInTheDocument();
});

test("focuses the first missing required field", async () => {
  form();
  await waitFor(() =>
    expect(screen.getByRole("textbox", { name: "Title" })).toHaveFocus(),
  );
});

test("submit is disabled until required fields are filled, then submits values", async () => {
  const { onSubmit } = form();
  const run = screen.getByRole("button", { name: "Run" });
  expect(run).toBeDisabled();
  await userEvent.type(screen.getByRole("textbox", { name: "Title" }), "Hello");
  expect(run).toBeEnabled();
  await userEvent.click(run);
  // Fields never given a value are left out, not nulled.
  expect(onSubmit).toHaveBeenCalledWith({ title: "Hello" });
});

test("a seeded form is ready to submit and a cleared nullable field submits null", async () => {
  const { onSubmit } = form({ initial: { title: "T", notes: "x" } });
  await userEvent.clear(screen.getByRole("textbox", { name: "Notes" }));
  await userEvent.click(screen.getByRole("button", { name: "Run" }));
  // Only the field that had a value and was cleared is nulled.
  expect(onSubmit).toHaveBeenCalledWith({ title: "T", notes: null });
});

test("a cleared optional non-nullable field omits its key", async () => {
  const { onSubmit } = form({ initial: { title: "T", priority: "low" } });
  await userEvent.click(screen.getByRole("radio", { name: "low" }));
  await userEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(onSubmit).toHaveBeenCalledWith({ title: "T" });
});

test("item search is limited to the field's types", async () => {
  search.mockClear();
  form();
  await waitFor(() => expect(search).toHaveBeenCalledWith("", ["task"]));
});

test("an item field takes an ItemSummary, or an id that stays empty and never searches the id", async () => {
  const [row] = rows as [ItemSummary];
  const a = form({ initial: { title: "T", parent: row } });
  expect(screen.getByRole("combobox", { name: "Parent" })).toHaveValue(
    "Write spec",
  );
  await userEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(a.onSubmit).toHaveBeenCalledWith({ title: "T", parent: row.id });
});

test("a bare item id shows an empty input, searches with an empty query and submits the id", async () => {
  search.mockClear();
  const { onSubmit } = form({ initial: { title: "T", parent: "abc-id" } });
  expect(screen.getByRole("combobox", { name: "Parent" })).toHaveValue("");
  await waitFor(() => expect(search).toHaveBeenCalled());
  expect(search.mock.calls.every(([q]) => q === "")).toBe(true);
  await userEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(onSubmit).toHaveBeenCalledWith({ title: "T", parent: "abc-id" });
});

test("picks an item by searching", async () => {
  const { onSubmit } = form({ initial: { title: "T" } });
  await userEvent.click(screen.getByRole("combobox", { name: "Parent" }));
  await userEvent.click(
    await screen.findByRole("option", { name: /Write spec/ }),
  );
  await userEvent.click(screen.getByRole("button", { name: "Run" }));
  expect(onSubmit.mock.calls[0]?.[0]).toMatchObject({ parent: rows[0]?.id });
});

test("Cancel calls onCancel", async () => {
  const { onCancel } = form();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(onCancel).toHaveBeenCalled();
});

function DueHarness({ onValue }: { onValue: (v: unknown) => void }) {
  const [v, setV] = useState<import("@dlh/core").Due | null>(null);
  return (
    <DueField
      label="Due"
      timeZone={zone}
      value={v}
      onChange={(n) => {
        setV(n);
        onValue(n);
      }}
    />
  );
}

test("DueField: date then time gives dateTime with the zone; clearing time gives date", async () => {
  const seen = vi.fn();
  render(<DueHarness onValue={seen} />);
  const date = screen.getByRole("group", { name: "Due" });
  await userEvent.click(
    date.querySelector('[data-type="month"]') as HTMLElement,
  );
  await userEvent.keyboard("11062026");
  expect(seen).toHaveBeenLastCalledWith({ date: "2026-11-06" });
  const time = screen.getByRole("group", { name: "Due time" });
  await userEvent.click(
    time.querySelector('[data-type="hour"]') as HTMLElement,
  );
  await userEvent.keyboard("0900");
  expect(seen).toHaveBeenLastCalledWith({
    dateTime: "2026-11-06T09:00:00-08:00",
    timeZone: zone,
  });
  await userEvent.click(screen.getByRole("button", { name: "Clear Due time" }));
  expect(seen).toHaveBeenLastCalledWith({ date: "2026-11-06" });
  expect(screen.queryByRole("button", { name: "Clear Due time" })).toBeNull();
});

test("SegmentedChoice keyboard selection", async () => {
  const onChange = vi.fn();
  render(
    <SegmentedChoice
      label="Priority"
      options={[
        { id: "low", label: "Low" },
        { id: "high", label: "High" },
      ]}
      value="low"
      onChange={onChange}
    />,
  );
  screen.getByRole("radio", { name: "Low" }).focus();
  await userEvent.keyboard("{ArrowRight}");
  await userEvent.keyboard(" ");
  expect(onChange).toHaveBeenLastCalledWith("high");
});

test("SidePanel closes on Esc", async () => {
  const onClose = vi.fn();
  render(
    <SidePanel title="Task" onClose={onClose}>
      <button type="button">Inside</button>
    </SidePanel>,
  );
  screen.getByRole("button", { name: "Inside" }).focus();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(1);
  // With focus outside the panel too.
  (document.activeElement as HTMLElement).blur();
  await userEvent.keyboard("{Escape}");
  expect(onClose).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole("button", { name: "Close" }));
  expect(onClose).toHaveBeenCalledTimes(3);
});

test("SidePanel takes focus on open and gives it back on close", () => {
  const trigger = document.createElement("button");
  document.body.append(trigger);
  trigger.focus();
  const { unmount } = render(
    <SidePanel title="Task" onClose={() => {}}>
      <p>x</p>
    </SidePanel>,
  );
  expect(screen.getByRole("complementary", { name: "Task" })).toHaveFocus();
  unmount();
  expect(trigger).toHaveFocus();
  trigger.remove();
});

test("SegmentedChoice labels with spaces and duplicates are labelled correctly", () => {
  const opts = [{ id: "a", label: "A" }];
  render(
    <>
      <SegmentedChoice
        label="Due soon"
        options={opts}
        value="a"
        onChange={() => {}}
      />
      <SegmentedChoice
        label="Due soon"
        options={opts}
        value="a"
        onChange={() => {}}
      />
    </>,
  );
  const groups = screen.getAllByRole("radiogroup", { name: "Due soon" });
  expect(groups).toHaveLength(2);
});
