import { deviceTimeZone, todayIn, weekStartOf } from "@dlh/core";
import {
  Button,
  Caption,
  Checkbox,
  DayBars,
  EmptyState,
  GlassPanel,
  ItemRow,
  ListGroup,
  ModulePage,
  ProgressBar,
  QueryState,
  SectionCard,
  Skeleton,
} from "@dlh/ui";
import { useInfiniteQuery } from "@tanstack/react-query";
import { ListChecks, Sun } from "lucide-react";
import type { TaskRow } from "../schema";
import { taskHref, useTasksApi } from "./api";
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

  const list = (
    <QueryState
      query={done}
      errorTitle="Couldn't load tasks"
      isEmpty={rows.length === 0}
      empty={<EmptyState icon={ListChecks} title="Nothing done yet" />}
    >
      {() => (
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
      )}
    </QueryState>
  );

  const week = stats.data;
  return (
    <ModulePage
      header={<TasksHeader current="/tasks/done" />}
      mainLabel="Done tasks"
      main={
        <>
          {todayClear ? (
            <GlassPanel level="panel">
              <EmptyState icon={Sun} title="Today is clear" />
            </GlassPanel>
          ) : null}
          <GlassPanel level="panel" className="flex flex-col gap-0.5 p-2.5">
            {list}
          </GlassPanel>
        </>
      }
      aside={
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
      }
    />
  );
}
