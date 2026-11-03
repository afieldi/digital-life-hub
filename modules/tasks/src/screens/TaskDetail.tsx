import {
  apiErrorKind,
  UNDO_TOAST_MS,
  useCommandBar,
  useCoreApi,
  useRecordView,
} from "@dlh/client";
import { deviceTimeZone, formatWhen, todayIn } from "@dlh/core";
import {
  Button,
  Caption,
  Checkbox,
  DueField,
  EmptyState,
  Menu,
  MenuItem,
  MenuSection,
  MenuTrigger,
  SegmentedChoice,
  SidePanel,
  Skeleton,
  TextArea,
  toast,
} from "@dlh/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CircleAlert, Ellipsis } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { taskOps } from "../operations";
import type { Priority, TaskRow } from "../schema";
import { TASKS_KEY, useTasksApi } from "./api";
import {
  LinkedSection,
  ParentsSection,
  SubtasksSection,
} from "./DetailSections";
import { editedLine } from "./detailView";
import { taskKeys } from "./queries";
import {
  queueVersioned,
  useRowCache,
  useTaskToggle,
  useVersionedWrite,
} from "./rowWrites";
import { useTaskEditor } from "./useTaskEditor";

const PRIORITIES: { id: Priority; label: string }[] = [
  { id: "medium", label: "Medium" },
  { id: "high", label: "High" },
];

/**
 * The Detail panel (`/tasks/$id`): done, due, priority, the tasks it is a
 * subtask of, its subtasks, notes (saved as you type), links, and when it was
 * created and edited. ⋯ holds the task's operations and AI. Records the view.
 */
export function TaskDetail({
  id,
  onClose,
}: {
  id: string;
  onClose: () => void;
}) {
  useRecordView(id);
  const tasks = useTasksApi();
  const core = useCoreApi();
  const timeZone = deviceTimeZone();
  const today = todayIn(new Date(), timeZone);
  const key = taskKeys.get(id, timeZone);
  const detail = useQuery({
    queryKey: key,
    queryFn: () => tasks.get.query({ id, timeZone }),
  });
  const item = useQuery({
    queryKey: taskKeys.item(id),
    queryFn: () => core.items.get.query({ id }),
  });
  const cache = useRowCache(key);
  const { toggle } = useTaskToggle(cache);
  const { draft, edit } = useTaskEditor(id, cache, detail.refetch);
  const [addingParent, setAddingParent] = useState(false);
  const parentSearch = useRef<HTMLDivElement>(null);

  // "Make subtask of…" opens the picker; focus its field once it is there.
  useEffect(() => {
    if (addingParent) parentSearch.current?.querySelector("input")?.focus();
  }, [addingParent]);

  const data = detail.data;
  if (!data) {
    return (
      <SidePanel title="Task" onClose={onClose}>
        {detail.isError && apiErrorKind(detail.error) === "gone" ? (
          // Deleted (here or elsewhere), or a stale link: retrying can't help.
          <EmptyState icon={CircleAlert} title="This task was deleted" />
        ) : detail.isError ? (
          <EmptyState
            icon={CircleAlert}
            title="Couldn't load the task"
            action={
              <Button variant="glass" onPress={() => void detail.refetch()}>
                Retry
              </Button>
            }
          />
        ) : (
          <Skeleton lines={6} />
        )}
      </SidePanel>
    );
  }

  const { task, subtasks, parents } = data;
  const done = task.completedAt !== null;
  const due = draft.due !== undefined ? draft.due : task.due;
  // Set in another zone: what it was there, as rows show it ("9:00 PT").
  const origin = due ? formatWhen(due, timeZone, today).origin : undefined;
  const priority = draft.priority ?? task.priority;
  const notes = draft.notes !== undefined ? draft.notes : task.notes;

  return (
    <SidePanel
      title={task.title}
      onClose={onClose}
      actions={
        <>
          <Checkbox
            aria-label={`${done ? "Mark not done" : "Complete"}: ${task.title}`}
            isSelected={done}
            onChange={() => toggle(task)}
          />
          <TaskMenu
            task={task}
            canNest={subtasks.length === 0}
            onToggle={() => toggle(task)}
            onAddParent={() => setAddingParent(true)}
            onDeleted={onClose}
          />
        </>
      }
    >
      <div className="flex flex-col gap-1">
        <DueField
          label="Due"
          value={due}
          timeZone={timeZone}
          onChange={(value) => edit({ due: value })}
        />
        {origin ? <Caption>· {origin}</Caption> : null}
      </div>
      <SegmentedChoice
        label="Priority"
        options={PRIORITIES}
        value={priority}
        onChange={(value) => value && edit({ priority: value }, { now: true })}
      />
      <ParentsSection
        task={task}
        parents={parents}
        hasSubtasks={subtasks.length > 0}
        adding={addingParent}
        setAdding={setAddingParent}
        searchRef={parentSearch}
      />
      <SubtasksSection
        task={task}
        subtasks={subtasks}
        canAdd={parents.length === 0}
        onToggle={toggle}
      />
      <TextArea
        label="Notes"
        rows={5}
        value={notes ?? ""}
        onChange={(text) => edit({ notes: text === "" ? null : text })}
      />
      <LinkedSection id={id} />
      {item.data ? (
        <Caption>
          {editedLine(item.data.createdAt, task.updatedAt, timeZone, today)}
        </Caption>
      ) : null}
    </SidePanel>
  );
}

/**
 * ⋯: the task's ⌘K operations, run from here (Reschedule goes to ⌘K for its
 * date), and Ask AI, which opens ⌘K.
 */
function TaskMenu({
  task,
  canNest,
  onToggle,
  onAddParent,
  onDeleted,
}: {
  task: TaskRow;
  canNest: boolean;
  onToggle: () => void;
  onAddParent: () => void;
  onDeleted: () => void;
}) {
  const tasks = useTasksApi();
  const core = useCoreApi();
  const queryClient = useQueryClient();
  const send = useVersionedWrite();
  const commandBar = useCommandBar();
  const done = task.completedAt !== null;

  const move = (position: "top" | "bottom") =>
    void send(task.id, task.updatedAt, (expectedUpdatedAt) => {
      const input = { id: task.id, expectedUpdatedAt, position };
      return {
        op: taskOps.reorder.id,
        summary: taskOps.reorder.summary(input),
        verb: "move the task",
        call: () => tasks.reorder.mutate(input),
      };
    });

  const remove = async () => {
    const refresh = () =>
      queryClient.invalidateQueries({ queryKey: TASKS_KEY });
    try {
      const deleted = await queueVersioned(
        task.id,
        task.updatedAt,
        (expectedUpdatedAt) =>
          core.items.delete.mutate({ id: task.id, expectedUpdatedAt }),
      );
      onDeleted();
      void refresh();
      toast(`Deleted ${task.title}`, {
        tone: "success",
        timeout: UNDO_TOAST_MS,
        actions: [
          {
            label: "Undo",
            onAction: () => {
              core.items.restore
                .mutate({ id: task.id, expectedUpdatedAt: deleted.updatedAt })
                .then(
                  () => void refresh(),
                  () => toast("Couldn't undo", { tone: "error" }),
                );
            },
          },
        ],
      });
    } catch {
      toast("Couldn't delete the task", { tone: "error" });
      void refresh();
    }
  };

  const actions: Record<string, () => void> = {
    toggle: onToggle,
    reschedule: () => commandBar.open("Reschedule "),
    top: () => move("top"),
    bottom: () => move("bottom"),
    nest: onAddParent,
    delete: () => void remove(),
    ai: () => commandBar.open(),
  };

  return (
    <MenuTrigger>
      <Button variant="icon" aria-label="More actions">
        <Ellipsis aria-hidden="true" size={18} />
      </Button>
      <Menu onAction={(key) => actions[String(key)]?.()}>
        <MenuSection title="Actions">
          <MenuItem id="toggle">{done ? "Reopen" : "Complete"}</MenuItem>
          <MenuItem id="reschedule">Reschedule…</MenuItem>
          <MenuItem id="top">Move to top</MenuItem>
          <MenuItem id="bottom">Move to bottom</MenuItem>
          {canNest ? <MenuItem id="nest">Make subtask of…</MenuItem> : null}
          <MenuItem id="delete">Delete</MenuItem>
        </MenuSection>
        <MenuSection title="AI">
          <MenuItem id="ai">Ask AI…</MenuItem>
        </MenuSection>
      </Menu>
    </MenuTrigger>
  );
}
