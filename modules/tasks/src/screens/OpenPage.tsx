import { queueVersionedMany } from "@dlh/client";
import { deviceTimeZone, todayIn } from "@dlh/core";
import {
  Button,
  Caption,
  EmptyState,
  GlassPanel,
  isTextEntry,
  KeyHints,
  ListGroup,
  ModulePage,
  ProgressBar,
  QueryState,
  Switch,
} from "@dlh/ui";
import { useNavigate } from "@tanstack/react-router";
import { ListChecks } from "lucide-react";
import { useEffect, useRef } from "react";
import { groupFor } from "../dates";
import { taskOps } from "../operations";
import { taskHref, useTasksApi, useTaskWrite } from "./api";
import { type ListSearch, useListSearch } from "./lastList";
import { groupOpenRows, nextUp, todayProgress } from "./openView";
import { QuickAdd } from "./QuickAdd";
import { taskKeys, useOpenList } from "./queries";
import { useRowCache, useTaskToggle } from "./rowWrites";
import { TaskRowView } from "./TaskRowView";
import { TasksHeader } from "./TasksHeader";

/** The Open screen (`/tasks`): quick add, tasks grouped by when, a side column. */
export function OpenPage({ search: given }: { search?: ListSearch }) {
  const search = useListSearch(given);
  const tasks = useTasksApi();
  const write = useTaskWrite();
  const navigate = useNavigate();
  const timeZone = deviceTimeZone();
  const today = todayIn(new Date(), timeZone);
  // High only lives in the URL (`?high=true`), so it survives a remount.
  const highOnly = search.high === true;
  const setHighOnly = (on: boolean) =>
    void navigate({ to: "/tasks", search: on ? { high: true } : {} });
  const quickAdd = useRef<HTMLInputElement>(null);

  const list = useOpenList();
  const rows = list.data?.rows ?? [];
  const cache = useRowCache(taskKeys.open(timeZone));
  const { patchRow } = cache;
  const { toggle } = useTaskToggle(cache);

  const groups = groupOpenRows(rows, today, { highOnly });
  // Reschedule all takes every overdue task, not only the ones High only shows.
  const overdue = rows.filter(
    (r) => !r.completedAt && groupFor(r.day, today) === "overdue",
  );

  const rescheduling = useRef(false);
  const rescheduleAll = async () => {
    // A second press while the first is on its way would send stale versions.
    if (rescheduling.current || overdue.length === 0) return;
    rescheduling.current = true;
    // Behind each task's pending writes, with the version each one got back.
    const items = await queueVersionedMany(
      overdue.map((r) => ({ id: r.id, seen: r.updatedAt })),
      (versions) => {
        const input = { items: versions, due: { date: today } };
        return write({
          op: taskOps.rescheduleMany.id,
          summary: taskOps.rescheduleMany.summary(input),
          verb: "reschedule",
          call: () => tasks.rescheduleMany.mutate(input),
        });
      },
      (res) => res ?? [],
    );
    for (const item of items ?? []) {
      patchRow(item.id, { updatedAt: item.updatedAt });
    }
    rescheduling.current = false;
  };

  // N: new task. X: complete the focused row. ↵: open it. Not while typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTextEntry(e.target)) return;
      const key = e.key.toLowerCase();
      if (key === "n") {
        e.preventDefault();
        quickAdd.current?.focus();
        return;
      }
      if (key !== "x" && key !== "enter") return;
      const el = e.target instanceof Element ? e.target : null;
      const id = el?.closest<HTMLElement>("[data-task-id]")?.dataset.taskId;
      const row = rows.find((r) => r.id === id);
      if (!row) return;
      if (key === "x") {
        e.preventDefault();
        toggle(row);
      } else if (!el?.closest("a")) {
        // A focused link opens itself.
        e.preventDefault();
        void navigate({ to: taskHref(row.id) });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [rows, toggle, navigate]);

  const progress = todayProgress(rows, today);
  const next = nextUp(rows, new Date(), timeZone);

  const content = (
    <QueryState
      query={list}
      errorTitle="Couldn't load tasks"
      isEmpty={rows.length === 0}
      empty={
        <EmptyState icon={ListChecks} title="Nothing open. Add one above" />
      }
    >
      {() =>
        groups.map((g) => (
          <ListGroup
            key={g.key}
            label={g.label}
            count={g.rows.filter((r) => !r.completedAt).length}
            tone={g.key === "overdue" ? "danger" : "default"}
            action={
              g.key === "overdue" ? (
                <Button variant="ghost" onPress={() => void rescheduleAll()}>
                  Reschedule all
                </Button>
              ) : undefined
            }
          >
            {g.rows.map((row) => (
              <TaskRowView
                key={row.id}
                row={row}
                today={today}
                timeZone={timeZone}
                onToggle={toggle}
                href={taskHref(row.id)}
              />
            ))}
          </ListGroup>
        ))
      }
    </QueryState>
  );

  return (
    <ModulePage
      header={<TasksHeader current="/tasks" search={search} />}
      mainLabel="Open tasks"
      main={
        <>
          <QuickAdd inputRef={quickAdd} />
          <GlassPanel level="panel" className="flex flex-col gap-0.5 p-2.5">
            {content}
          </GlassPanel>
        </>
      }
      asideLabel="Summary and filters"
      aside={
        <>
          <GlassPanel level="panel" className="flex flex-col gap-3 p-5">
            {progress.total > 0 ? (
              <ProgressBar
                value={progress.done}
                max={progress.total}
                label="Today"
              />
            ) : null}
            {next ? (
              <Caption>
                Next up at {next.time}: {next.title}
              </Caption>
            ) : null}
            <Switch isSelected={highOnly} onChange={setHighOnly}>
              High priority only
            </Switch>
          </GlassPanel>
          <KeyHints
            hints={[
              { keys: ["N"], label: "new task" },
              { keys: ["X"], label: "complete" },
              { keys: ["↵"], label: "open" },
            ]}
          />
        </>
      }
    />
  );
}
