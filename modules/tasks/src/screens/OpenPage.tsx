import {
  Button,
  Caption,
  EmptyState,
  GlassPanel,
  KeyHints,
  ListGroup,
  ProgressBar,
  Skeleton,
  Switch,
} from "@dlh/ui";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, ListChecks } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { groupFor, todayIn } from "../dates";
import { taskOps } from "../operations";
import { deviceTimeZone, taskHref, useTasksApi, useTaskWrite } from "./api";
import { groupOpenRows, nextUp, todayProgress } from "./openView";
import { QuickAdd } from "./QuickAdd";
import { taskKeys, useOpenList } from "./queries";
import { useRowCache, useTaskToggle } from "./rowWrites";
import { TaskRowView } from "./TaskRowView";
import { TasksHeader } from "./TasksHeader";

/** Text inputs swallow keys; checkboxes, links and buttons don't. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement &&
    !/^(checkbox|radio|button|submit|reset|range|color|file)$/.test(target.type)
  );
}

/** The Open screen (`/tasks`): quick add, tasks grouped by when, a side column. */
export function OpenPage() {
  const tasks = useTasksApi();
  const write = useTaskWrite();
  const navigate = useNavigate();
  const timeZone = deviceTimeZone();
  const today = todayIn(new Date(), timeZone);
  const [highOnly, setHighOnly] = useState(false);
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
    const input = {
      items: overdue.map((r) => ({ id: r.id, expectedUpdatedAt: r.updatedAt })),
      due: { date: today },
    };
    const items = await write({
      op: taskOps.rescheduleMany.id,
      summary: taskOps.rescheduleMany.summary(input),
      verb: "reschedule",
      call: () => tasks.rescheduleMany.mutate(input),
    });
    for (const item of items ?? []) {
      patchRow(item.id, { updatedAt: item.updatedAt });
    }
    rescheduling.current = false;
  };

  // N: new task. X: complete the focused row. ↵: open it. Not while typing.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;
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

  let content: ReactNode;
  if (list.isPending) {
    content = <Skeleton lines={5} />;
  } else if (list.isError) {
    content = (
      <EmptyState
        icon={CircleAlert}
        title="Couldn't load tasks"
        action={
          <Button variant="glass" onPress={() => void list.refetch()}>
            Retry
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    content = (
      <EmptyState icon={ListChecks} title="Nothing open. Add one above" />
    );
  } else {
    content = groups.map((g) => (
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
    ));
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 pt-8 pb-[150px]">
      <TasksHeader current="/tasks" />
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-label="Open tasks"
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-4"
        >
          <QuickAdd inputRef={quickAdd} />
          <GlassPanel level="panel" className="flex flex-col gap-0.5 p-2.5">
            {content}
          </GlassPanel>
        </section>
        <aside
          aria-label="Summary and filters"
          className="flex flex-[1_1_280px] flex-col gap-4"
        >
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
        </aside>
      </div>
    </div>
  );
}
