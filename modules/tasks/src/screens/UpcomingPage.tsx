import {
  Board,
  Button,
  Caption,
  EmptyState,
  GlassPanel,
  ListGroup,
  PeriodNav,
  Skeleton,
} from "@dlh/ui";
import { useNavigate } from "@tanstack/react-router";
import { CircleAlert } from "lucide-react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import {
  addDays,
  type Day,
  formatDue,
  moveToDay,
  todayIn,
  weekStartOf,
} from "../dates";
import { taskOps } from "../operations";
import type { TaskRow } from "../schema";
import { deviceTimeZone, taskHref, useTasksApi } from "./api";
import { type ListSearch, useListSearch } from "./lastList";
import { QuickAdd } from "./QuickAdd";
import { taskKeys, useUpcomingList } from "./queries";
import { useRowCache, useTaskToggle, useVersionedWrite } from "./rowWrites";
import { TaskRowView } from "./TaskRowView";
import { TasksHeader } from "./TasksHeader";
import {
  cardWhen,
  dropPosition,
  splitUpcoming,
  weekColumns,
  weekLabel,
} from "./upcomingView";

// Column dots: a busy day (4 or more) stands out.
const DOT = "var(--color-ink-tertiary)";
const BUSY_DOT = "var(--color-type-note)";

/**
 * Upcoming (`/tasks/upcoming`): the week as seven day columns, Monday first.
 * Dragging a card to another day reschedules it, keeping its time; Add on a
 * day opens quick add with that day filled in. Later lists what comes after.
 */
export function UpcomingPage({ search: given }: { search?: ListSearch }) {
  const search = useListSearch(given);
  const navigate = useNavigate();
  const tasks = useTasksApi();
  const send = useVersionedWrite();
  const timeZone = deviceTimeZone();
  const today = todayIn(new Date(), timeZone);
  // The week lives in the URL (`?week=`), so it survives a remount.
  const weekStart = weekStartOf(search.week ?? today);
  const showWeek = (start: Day) =>
    void navigate({ to: "/tasks/upcoming", search: { week: start } });
  const [addDay, setAddDay] = useState<Day | null>(null);
  const quickAdd = useRef<HTMLInputElement>(null);

  const list = useUpcomingList(weekStart);
  const cache = useRowCache(taskKeys.upcoming(timeZone, weekStart));
  const { toggle } = useTaskToggle(cache);
  const rows = list.data?.rows ?? [];
  const { week, later } = splitUpcoming(rows, weekStart);
  const columns = weekColumns(weekStart).map((c) => ({
    id: c.id,
    title: c.title,
    dot: week.filter((r) => r.day === c.id).length >= 4 ? BUSY_DOT : DOT,
  }));

  useEffect(() => {
    if (addDay) quickAdd.current?.focus();
  }, [addDay]);

  const move = (id: string, toDay: string, index: number) => {
    const row = cache.cachedRow(id);
    if (!row?.due) return;
    if (row.day !== toDay) {
      const due = moveToDay(row.due, toDay, timeZone);
      // Shows on the new day at once; the write's refresh confirms it.
      cache.patchRow(id, { due, day: toDay }, true);
      void send(id, row.updatedAt, (expectedUpdatedAt) => {
        const input = { id, expectedUpdatedAt, due };
        return {
          op: taskOps.reschedule.id,
          summary: taskOps.reschedule.summary(input),
          verb: "reschedule the task",
          call: () => tasks.reschedule.mutate(input),
        };
      });
      return;
    }
    const others = week
      .filter((r) => r.day === toDay && r.id !== id)
      .map((r) => r.id);
    void send(id, row.updatedAt, (expectedUpdatedAt) => {
      const input = {
        id,
        expectedUpdatedAt,
        position: dropPosition(others, index),
      };
      return {
        op: taskOps.reorder.id,
        summary: taskOps.reorder.summary(input),
        verb: "move the task",
        call: () => tasks.reorder.mutate(input),
      };
    });
  };

  let board: ReactNode;
  if (list.isPending) {
    board = <Skeleton lines={5} />;
  } else if (list.isError) {
    board = (
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
  } else {
    board = (
      <div className="overflow-x-auto pb-2">
        <Board<TaskRow>
          columns={columns}
          items={week}
          columnOf={(r) => r.day ?? ""}
          textValue={(r) => r.title}
          hrefOf={(r) => taskHref(r.id)}
          onMove={move}
          onAdd={setAddDay}
          addLabel="Add"
          renderCard={(r) => (
            <>
              <span>{r.title}</span>
              <Caption>{cardWhen(r, timeZone)}</Caption>
            </>
          )}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-[1960px] flex-col gap-5 px-6 pt-8 pb-[150px]">
      <TasksHeader current="/tasks/upcoming" search={search} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodNav
          label={weekLabel(weekStart)}
          previousLabel="Previous week"
          nextLabel="Next week"
          onPrevious={() => showWeek(addDays(weekStart, -7))}
          onNext={() => showWeek(addDays(weekStart, 7))}
        />
        <Caption>Drag a task onto a day to reschedule it</Caption>
      </div>
      {addDay ? (
        <QuickAdd
          key={addDay}
          defaultDue={{ date: addDay }}
          inputRef={quickAdd}
          onCreated={() => setAddDay(null)}
        />
      ) : null}
      {board}
      {later.length > 0 ? (
        <GlassPanel level="panel" className="flex flex-col gap-0.5 p-2.5">
          <ListGroup
            label="Later"
            count={later.length}
            action={
              <Caption>
                After {formatDue({ date: addDays(weekStart, 6) })}
              </Caption>
            }
          >
            {later.map((row) => (
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
        </GlassPanel>
      ) : null}
    </div>
  );
}
