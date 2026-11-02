import type { FieldSpec, ItemSummary } from "@dlh/core";
import { Ellipsis } from "lucide-react";
import { useState } from "react";
import { DueField } from "../../patterns/DueField";
import { ItemSearchField } from "../../patterns/ItemSearchField";
import { OperationForm } from "../../patterns/OperationForm";
import { SidePanel } from "../../patterns/SidePanel";
import { Button } from "../../primitives/Button";
import { SegmentedChoice } from "../../primitives/SegmentedChoice";
import { Select } from "../../primitives/Select";
import { Skeleton } from "../../primitives/Skeleton";
import { TextArea } from "../../primitives/TextArea";
import { registerStories } from "../registry";
import { OverlayBox } from "./OverlayBox";

const noop = () => {};
const box = "w-[440px] p-6";

const rows: ItemSummary[] = [
  { id: "1", type: "task", title: "Write the spec", archivedAt: null },
  { id: "2", type: "task", title: "Review the board", archivedAt: null },
];
const search = async () => rows;

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

function SegmentedDemo() {
  const [v, setV] = useState<"day" | "week" | "month" | null>("week");
  return (
    <SegmentedChoice
      label="Range"
      options={[
        { id: "day", label: "Day" },
        { id: "week", label: "Week" },
        { id: "month", label: "Month" },
      ]}
      value={v}
      onChange={setV}
    />
  );
}

function SelectDemo() {
  const [v, setV] = useState<string | null>(null);
  return (
    <Select
      label="Status"
      options={["Inbox", "Next", "Waiting", "Someday", "Done"].map((s) => ({
        id: s,
        label: s,
      }))}
      value={v}
      onChange={setV}
    />
  );
}

function DueDemo({ initial }: { initial: import("@dlh/core").Due | null }) {
  const [v, setV] = useState(initial);
  return (
    <DueField
      label="Due"
      value={v}
      onChange={setV}
      timeZone="America/Los_Angeles"
    />
  );
}

function ItemDemo() {
  const [v, setV] = useState<ItemSummary | null>(rows[0] ?? null);
  return (
    <ItemSearchField
      label="Parent"
      types={["task"]}
      search={search}
      value={v}
      onChange={setV}
    />
  );
}

function AreaDemo() {
  const [v, setV] = useState("Draft the intro,\nthen the rollout plan.");
  return <TextArea label="Notes" value={v} onChange={setV} />;
}

registerStories("forms", [
  {
    id: "forms/segmented-choice",
    title: "SegmentedChoice",
    render: () => (
      <div className={box}>
        <SegmentedDemo />
      </div>
    ),
  },
  {
    id: "forms/select",
    title: "Select",
    render: () => (
      <div className={box}>
        <SelectDemo />
      </div>
    ),
  },
  {
    id: "forms/textarea",
    title: "TextArea",
    render: () => (
      <div className={box}>
        <AreaDemo />
      </div>
    ),
  },
  {
    id: "forms/skeleton",
    title: "Skeleton",
    render: () => (
      <div className={box}>
        <Skeleton lines={4} />
      </div>
    ),
  },
  {
    id: "forms/due-field",
    title: "DueField (date and time)",
    render: () => (
      <div className="w-[520px] p-6">
        <DueDemo
          initial={{
            dateTime: "2026-11-06T09:00:00-08:00",
            timeZone: "America/Los_Angeles",
          }}
        />
      </div>
    ),
  },
  {
    id: "forms/due-field-empty",
    title: "DueField (empty)",
    render: () => (
      <div className="w-[520px] p-6">
        <DueDemo initial={null} />
      </div>
    ),
  },
  {
    id: "forms/item-search-field",
    title: "ItemSearchField",
    render: () => (
      <div className={box}>
        <ItemDemo />
      </div>
    ),
  },
  {
    id: "forms/side-panel",
    title: "SidePanel",
    render: () => (
      <div className="h-[420px] w-[420px] p-4">
        <SidePanel title="Write the spec" onClose={noop}>
          <Skeleton lines={3} />
          <SegmentedDemo />
        </SidePanel>
      </div>
    ),
  },
  {
    id: "forms/side-panel-actions",
    title: "SidePanel with actions",
    render: () => (
      <div className="h-[260px] w-[420px] p-4">
        <SidePanel
          title="Write the spec"
          onClose={noop}
          actions={
            <Button variant="icon" aria-label="More actions">
              <Ellipsis aria-hidden="true" size={18} />
            </Button>
          }
        >
          <Skeleton lines={2} />
        </SidePanel>
      </div>
    ),
  },
  {
    id: "forms/operation-form",
    title: "OperationForm (open)",
    render: () => (
      <OverlayBox height={700} width={520}>
        {() => (
          <OperationForm
            contained
            title="Add task"
            fields={fields}
            initial={{ title: "Plan the offsite" }}
            timeZone="America/Los_Angeles"
            search={search}
            onSubmit={noop}
            onCancel={noop}
          />
        )}
      </OverlayBox>
    ),
  },
]);
