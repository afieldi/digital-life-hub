import { Breadcrumb, PageHeader, ViewTabs } from "@dlh/ui";
import { useEffect } from "react";
import { todayIn, weekStartOf } from "../dates";
import { deviceTimeZone } from "./api";
import { rememberList, type TaskListPath } from "./lastList";
import { comingUpCount, openCount, openStatus } from "./openView";
import { useOpenList, useUpcomingList, useWeekStats } from "./queries";

const VIEWS: { path: TaskListPath; label: string }[] = [
  { path: "/tasks", label: "Open" },
  { path: "/tasks/upcoming", label: "Upcoming" },
  { path: "/tasks/done", label: "Done" },
];

/**
 * The top of every Tasks list: breadcrumb, "Tasks" with a status line, and
 * the Open · N / Upcoming · N / Done tabs.
 */
export function TasksHeader({ current }: { current: TaskListPath }) {
  useEffect(() => {
    rememberList(current);
    // Gone from the Tasks lists (not just into Detail, which reads this while
    // rendering, first): a task opened from elsewhere shows over Open.
    return () => rememberList("/tasks");
  }, [current]);
  const timeZone = deviceTimeZone();
  const today = todayIn(new Date(), timeZone);
  const open = useOpenList();
  const upcoming = useUpcomingList(weekStartOf(today));
  const stats = useWeekStats(weekStartOf(today), current === "/tasks/done");

  const openRows = open.data?.rows;
  const upcomingRows = upcoming.data?.rows;
  const counts: Record<TaskListPath, number | undefined> = {
    "/tasks": openRows && openCount(openRows),
    "/tasks/upcoming": upcomingRows && comingUpCount(upcomingRows, today),
    "/tasks/done": undefined,
  };
  const status =
    current === "/tasks"
      ? openRows && openStatus(openRows, today)
      : current === "/tasks/upcoming"
        ? upcomingRows && `${counts["/tasks/upcoming"]} coming up`
        : stats.data && `${stats.data.done} done this week`;

  const here = VIEWS.find((v) => v.path === current);
  return (
    <>
      <Breadcrumb
        items={[
          { label: "Home", href: "/" },
          current === "/tasks"
            ? { label: "Tasks" }
            : { label: "Tasks", href: "/tasks" },
          ...(current === "/tasks" || !here ? [] : [{ label: here.label }]),
        ]}
      />
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader title="Tasks" subtitle={status} />
        <ViewTabs
          label="Task views"
          tabs={VIEWS.map((v) => {
            const count = counts[v.path];
            return {
              label: count === undefined ? v.label : `${v.label} · ${count}`,
              href: v.path,
              current: v.path === current,
            };
          })}
        />
      </div>
    </>
  );
}
