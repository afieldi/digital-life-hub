import { useCoreApi, useItemHref, useItemType } from "@dlh/client";
import type { ItemSummary } from "@dlh/core";
import {
  Button,
  Checkbox,
  Chip,
  ItemRow,
  ItemSearchField,
  ListGroup,
  ProgressBar,
  SortableList,
  TextField,
  TypeTile,
} from "@dlh/ui";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { type Ref, useState } from "react";
import { taskOps } from "../operations";
import type { TaskRow } from "../schema";
import { taskHref, useTasksApi, useTaskWrite } from "./api";
import { linkedRows } from "./detailView";
import { taskKeys } from "./queries";
import { useVersionedWrite } from "./rowWrites";
import { dropPosition } from "./upcomingView";

/** Finds tasks by title for the task pickers, leaving out `exclude`. */
function useTaskSearch(exclude: string[]) {
  const core = useCoreApi();
  return async (query: string) => {
    const found = await core.search.query({ query, types: ["task"] });
    return found.filter((i) => !exclude.includes(i.id));
  };
}

/** Links `childId` under `parentId` with `addParent`. */
function useAddParent() {
  const tasks = useTasksApi();
  const write = useTaskWrite();
  return (childId: string, parentId: string) => {
    const input = { id: childId, parentId };
    return write({
      op: taskOps.addParent.id,
      summary: taskOps.addParent.summary(input),
      verb: "add the subtask",
      call: () => tasks.addParent.mutate(input),
    });
  };
}

/**
 * "Subtask of": a chip per parent task, × to take it out, and "+ Add to
 * task…" to put it under another. A task with subtasks can't become one.
 */
export function ParentsSection({
  task,
  parents,
  hasSubtasks,
  adding,
  setAdding,
  searchRef,
}: {
  task: TaskRow;
  parents: ItemSummary[];
  hasSubtasks: boolean;
  adding: boolean;
  setAdding: (on: boolean) => void;
  searchRef?: Ref<HTMLDivElement>;
}) {
  const tasks = useTasksApi();
  const write = useTaskWrite();
  const addParent = useAddParent();
  const search = useTaskSearch([task.id, ...parents.map((p) => p.id)]);
  if (hasSubtasks && parents.length === 0) return null;

  const remove = (parent: ItemSummary) => {
    const input = { id: task.id, parentId: parent.id };
    void write({
      op: taskOps.removeParent.id,
      summary: taskOps.removeParent.summary(input),
      verb: "remove it from the task",
      call: () => tasks.removeParent.mutate(input),
    });
  };

  return (
    <ListGroup label="Subtask of" count={parents.length}>
      <div className="flex flex-wrap items-center gap-2 px-3">
        {parents.map((p) => (
          <Chip
            key={p.id}
            kind="project"
            color="var(--color-type-task)"
            href={taskHref(p.id)}
            onRemove={() => remove(p)}
            removeLabel={`Remove from ${p.title}`}
          >
            {p.title}
          </Chip>
        ))}
        {hasSubtasks || adding ? null : (
          <Button variant="ghost" onPress={() => setAdding(true)}>
            <Plus aria-hidden="true" size={16} />
            Add to task…
          </Button>
        )}
      </div>
      {adding ? (
        <div ref={searchRef} className="px-3">
          <ItemSearchField
            label="Add to task"
            types={["task"]}
            search={search}
            value={null}
            onChange={(picked) => {
              if (!picked) return;
              setAdding(false);
              void addParent(task.id, picked.id);
            }}
          />
        </div>
      ) : null}
    </ListGroup>
  );
}

/**
 * Subtasks: tick, open, drag to reorder; add a new one or an existing task.
 * A subtask can't have subtasks, so a task with parents can't add any.
 */
export function SubtasksSection({
  task,
  subtasks,
  canAdd,
  onToggle,
}: {
  task: TaskRow;
  subtasks: TaskRow[];
  canAdd: boolean;
  onToggle: (row: TaskRow) => void;
}) {
  const tasks = useTasksApi();
  const write = useTaskWrite();
  const send = useVersionedWrite();
  const addParent = useAddParent();
  const search = useTaskSearch([task.id, ...subtasks.map((s) => s.id)]);
  const [title, setTitle] = useState("");
  // Bumped to clear the picker after each pick.
  const [picks, setPicks] = useState(0);
  if (subtasks.length === 0 && !canAdd) return null;

  const done = subtasks.filter((s) => s.completedAt !== null).length;

  const create = async () => {
    const text = title.trim();
    if (!text) return;
    const input = { title: text, parentId: task.id };
    const created = await write({
      op: taskOps.create.id,
      summary: taskOps.create.summary(input),
      verb: "add the subtask",
      call: () => tasks.create.mutate(input),
    });
    if (created) setTitle("");
  };

  const move = (id: string, index: number) => {
    const row = subtasks.find((s) => s.id === id);
    if (!row) return;
    const others = subtasks.filter((s) => s.id !== id).map((s) => s.id);
    void send(id, row.updatedAt, (expectedUpdatedAt) => {
      const input = {
        id,
        expectedUpdatedAt,
        position: dropPosition(others, index),
      };
      return {
        op: taskOps.reorder.id,
        summary: taskOps.reorder.summary(input),
        verb: "move the subtask",
        call: () => tasks.reorder.mutate(input),
      };
    });
  };

  return (
    <ListGroup label="Subtasks" count={subtasks.length}>
      {subtasks.length > 0 ? (
        <div className="flex flex-col gap-2 px-3">
          <ProgressBar value={done} max={subtasks.length} label="Done" />
        </div>
      ) : null}
      <SortableList
        label="Subtasks"
        items={subtasks}
        textValue={(s) => s.title}
        onMove={move}
        renderItem={(s) => {
          const isDone = s.completedAt !== null;
          return (
            <ItemRow
              title={s.title}
              href={taskHref(s.id)}
              done={isDone}
              leading={
                <Checkbox
                  aria-label={`${isDone ? "Mark not done" : "Complete"}: ${s.title}`}
                  isSelected={isDone}
                  onChange={() => onToggle(s)}
                />
              }
            />
          );
        }}
      />
      {canAdd ? (
        <div className="flex flex-col gap-3 px-3 pt-2">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void create();
            }}
          >
            <TextField
              label="Add a subtask"
              value={title}
              onChange={setTitle}
              placeholder="A step, then ↵"
            />
          </form>
          <ItemSearchField
            key={picks}
            label="Add existing"
            types={["task"]}
            search={search}
            value={null}
            onChange={(picked) => {
              if (!picked) return;
              setPicks((n) => n + 1);
              void addParent(picked.id, task.id);
            }}
          />
        </div>
      ) : null}
    </ListGroup>
  );
}

/** Linked: the task's other links, both ways; hidden when it has none. */
export function LinkedSection({ id }: { id: string }) {
  const core = useCoreApi();
  const itemHref = useItemHref();
  const itemType = useItemType();
  const links = useQuery({
    queryKey: taskKeys.links(id),
    queryFn: () => core.links.forItem.query({ id }),
  });
  const rows = links.data ? linkedRows(links.data) : [];
  if (rows.length === 0) return null;
  return (
    <ListGroup label="Linked" count={rows.length}>
      {rows.map(({ link, item, direction }) => {
        const look = itemType(item.type);
        // A type no module owns shows its raw name and no tile.
        const label = look?.label ?? item.type;
        return (
          <ItemRow
            key={link.id}
            title={item.title}
            href={itemHref(item)}
            leading={
              look ? (
                <TypeTile glyph={look.glyph} color={look.color} size={30} />
              ) : undefined
            }
            meta={
              link.context ??
              (direction === "backlink" ? `${label} · links here` : label)
            }
          />
        );
      })}
    </ListGroup>
  );
}
