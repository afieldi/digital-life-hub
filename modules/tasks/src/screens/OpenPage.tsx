import {
  Breadcrumb,
  Button,
  Caption,
  EmptyState,
  GlassPanel,
  KeyHints,
  ListGroup,
  PageHeader,
  ProgressBar,
  Skeleton,
  Switch,
  toast,
} from "@dlh/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert, ListChecks } from "lucide-react";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { groupFor, todayIn } from "../dates";
import { taskOps } from "../operations";
import type { TaskRow } from "../schema";
import { deviceTimeZone, TASKS_KEY, useTasksApi, useTaskWrite } from "./api";
import { groupOpenRows, nextUp, todayProgress } from "./openView";
import { QuickAdd } from "./QuickAdd";
import { TaskRowView } from "./TaskRowView";

const taskHref = (id: string) => `/tasks/${id}`;

const openListKey = (timeZone: string) =>
  [...TASKS_KEY, "list", "open", timeZone] as const;

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
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const timeZone = deviceTimeZone();
  const today = todayIn(new Date(), timeZone);
  const [highOnly, setHighOnly] = useState(false);
  const quickAdd = useRef<HTMLInputElement>(null);

  const list = useQuery({
    queryKey: openListKey(timeZone),
    queryFn: () => tasks.list.query({ view: "open", timeZone }),
  });
  const rows = list.data?.rows ?? [];

  /** Shows the tick at once; the write's refresh brings the server's version. */
  const setCompleted = useCallback(
    (id: string, completedAt: string | null) => {
      // A refetch already on its way would put the old state back.
      void queryClient.cancelQueries({ queryKey: openListKey(timeZone) });
      queryClient.setQueryData<{ rows: TaskRow[] }>(
        openListKey(timeZone),
        (old) =>
          old
            ? {
                ...old,
                rows: old.rows.map((r) =>
                  r.id === id ? { ...r, completedAt } : r,
                ),
              }
            : old,
      );
    },
    [queryClient, timeZone],
  );

  const complete = useCallback(
    async (id: string, expectedUpdatedAt: string) => {
      const input = { id, expectedUpdatedAt };
      const res = await write({
        op: taskOps.complete.id,
        summary: taskOps.complete.summary(input),
        verb: "complete the task",
        call: () => tasks.complete.mutate(input),
      });
      return res?.parentsNowDone ?? [];
    },
    [tasks, write],
  );

  const completeParent = useCallback(
    async (id: string) => {
      try {
        const { task } = await tasks.get.query({ id, timeZone });
        await complete(task.id, task.updatedAt);
      } catch {
        toast("Couldn't complete the task", { tone: "error" });
      }
    },
    [tasks, complete, timeZone],
  );

  const toggle = useCallback(
    async (row: TaskRow) => {
      const input = { id: row.id, expectedUpdatedAt: row.updatedAt };
      if (row.completedAt) {
        setCompleted(row.id, null);
        await write({
          op: taskOps.reopen.id,
          summary: taskOps.reopen.summary(input),
          verb: "reopen the task",
          call: () => tasks.reopen.mutate(input),
        });
        return;
      }
      setCompleted(row.id, new Date().toISOString());
      for (const parent of await complete(row.id, row.updatedAt)) {
        toast("All subtasks done. Complete the task?", {
          actions: [
            {
              label: "Complete",
              onAction: () => void completeParent(parent.id),
            },
          ],
        });
      }
    },
    [tasks, write, complete, completeParent, setCompleted],
  );

  const groups = groupOpenRows(rows, today, { highOnly });
  // Reschedule all takes every overdue task, not only the ones High only shows.
  const overdue = rows.filter(
    (r) => !r.completedAt && groupFor(r.day, today) === "overdue",
  );

  const rescheduleAll = () => {
    const input = {
      items: overdue.map((r) => ({ id: r.id, expectedUpdatedAt: r.updatedAt })),
      due: { date: today },
    };
    void write({
      op: taskOps.rescheduleMany.id,
      summary: taskOps.rescheduleMany.summary(input),
      verb: "reschedule",
      call: () => tasks.rescheduleMany.mutate(input),
    });
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
        void toggle(row);
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
            <Button variant="ghost" onPress={rescheduleAll}>
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
            onToggle={(r) => void toggle(r)}
            href={taskHref(row.id)}
          />
        ))}
      </ListGroup>
    ));
  }

  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 pt-8 pb-[150px]">
      <Breadcrumb items={[{ label: "Home", href: "/" }, { label: "Tasks" }]} />
      <PageHeader title="Tasks" />
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
