import {
  Button,
  Caption,
  Checkbox,
  DayBars,
  EmptyState,
  GlassPanel,
  ItemRow,
  ListGroup,
  ProgressBar,
  SectionCard,
  Skeleton,
} from "@dlh/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { CircleAlert, ListChecks, Sun } from "lucide-react";
import type { ReactNode } from "react";
import { todayIn, weekStartOf } from "../dates";
import type { TaskRow } from "../schema";
import { deviceTimeZone, taskHref, useTasksApi } from "./api";
import { dayBars, doneMeta, groupDone } from "./doneView";
import type { ListSearch } from "./lastList";
import { taskKeys, useOpenList, useWeekStats } from "./queries";
import { useRowCache, useTaskToggle } from "./rowWrites";
import { TasksHeader } from "./TasksHeader";

/**
 * Done (`/tasks/done`): "Today is clear" when nothing open is due today; done
 * tasks by the day they were completed, each with Undo, a page at a time; and
 * this week's completions beside them.
 */
export function DonePage(_: { search?: ListSearch }) {
  const tasks = useTasksApi();
  const timeZone = deviceTimeZone();
  const today = todayIn(new Date(), timeZone);
  const key = taskKeys.done(timeZone);

  const done = useInfiniteQuery({
    queryKey: key,
    queryFn: ({ pageParam }) =>
      tasks.list.query({ view: "done", timeZone, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor,
  });
  const open = useOpenList();
  const stats = useWeekStats(weekStartOf(today));
  const cache = useRowCache(key);
  const { reopen } = useTaskToggle(cache);

  // Unticking or Undo reopens at once; the refresh then drops the row.
  const undo = (row: TaskRow) => {
    const current = cache.cachedRow(row.id) ?? row;
    cache.patchRow(row.id, { completedAt: null }, true);
    void reopen(row.id, current.updatedAt);
  };

  const rows = (done.data?.pages.flatMap((p) => p.rows) ?? []).filter(
    (r) => r.completedAt !== null,
  );
  const todayClear =
    open.data !== undefined &&
    !open.data.rows.some((r) => r.completedAt === null && r.day === today);

  let list: ReactNode;
  if (done.isPending) {
    list = <Skeleton lines={5} />;
  } else if (done.isError) {
    list = (
      <EmptyState
        icon={CircleAlert}
        title="Couldn't load tasks"
        action={
          <Button variant="glass" onPress={() => void done.refetch()}>
            Retry
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    list = <EmptyState icon={ListChecks} title="Nothing done yet" />;
  } else {
    list = (
      <>
        {groupDone(rows, today, timeZone).map((g) => (
          <ListGroup key={g.day} label={g.label} count={g.rows.length}>
            {g.rows.map((row) => (
              <ItemRow
                key={row.id}
                done
                title={row.title}
                href={taskHref(row.id)}
                meta={doneMeta(row, timeZone)}
                leading={
                  <Checkbox
                    aria-label={`Mark not done: ${row.title}`}
                    isSelected
                    onChange={() => undo(row)}
                  />
                }
                trailing={
                  <Button
                    variant="ghost"
                    aria-label={`Undo: ${row.title}`}
                    onPress={() => undo(row)}
                  >
                    Undo
                  </Button>
                }
              />
            ))}
          </ListGroup>
        ))}
        {done.hasNextPage ? (
          <Button
            variant="ghost"
            isDisabled={done.isFetchingNextPage}
            onPress={() => void done.fetchNextPage()}
          >
            Show more
          </Button>
        ) : null}
      </>
    );
  }

  const week = stats.data;
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 pt-8 pb-[150px]">
      <TasksHeader current="/tasks/done" />
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-label="Done tasks"
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-4"
        >
          {todayClear ? (
            <GlassPanel level="panel">
              <EmptyState icon={Sun} title="Today is clear" />
            </GlassPanel>
          ) : null}
          <GlassPanel level="panel" className="flex flex-col gap-0.5 p-2.5">
            {list}
          </GlassPanel>
        </section>
        <div className="flex flex-[1_1_280px] flex-col">
          <SectionCard title="This week">
            {week ? (
              <div className="flex flex-col gap-4">
                <DayBars
                  label="Tasks done per day"
                  bars={dayBars(week.perDay)}
                  highlight={week.perDay.findIndex((d) => d.day === today)}
                />
                {week.done > 0 ? (
                  <ProgressBar
                    value={week.onTime}
                    max={week.done}
                    label="On time"
                  />
                ) : null}
                <Caption>Cleared overdue: {week.overdueCleared}</Caption>
                <Caption>Last week: {week.lastWeek}</Caption>
              </div>
            ) : (
              <Skeleton lines={3} />
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
