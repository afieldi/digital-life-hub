import { type Day, deviceTimeZone } from "@dlh/core";
import { useQuery } from "@tanstack/react-query";
import { TASKS_KEY, useTasksApi } from "./api";

/** Query keys for the Tasks screens; all start with `TASKS_KEY`. */
export const taskKeys = {
  open: (tz: string) => [...TASKS_KEY, "list", "open", tz] as const,
  upcoming: (tz: string, weekStart: Day) =>
    [...TASKS_KEY, "list", "upcoming", tz, weekStart] as const,
  done: (tz: string) => [...TASKS_KEY, "list", "done", tz] as const,
  stats: (tz: string, weekStart: Day) =>
    [...TASKS_KEY, "stats", tz, weekStart] as const,
  get: (id: string, tz: string) => [...TASKS_KEY, "get", id, tz] as const,
  links: (id: string) => [...TASKS_KEY, "links", id] as const,
  item: (id: string) => [...TASKS_KEY, "item", id] as const,
};

/** Open tasks and those done today, in the device's zone. */
export function useOpenList() {
  const tasks = useTasksApi();
  const timeZone = deviceTimeZone();
  return useQuery({
    queryKey: taskKeys.open(timeZone),
    queryFn: () => tasks.list.query({ view: "open", timeZone }),
  });
}

/** Open tasks due in the week from `weekStart`, or later. */
export function useUpcomingList(weekStart: Day) {
  const tasks = useTasksApi();
  const timeZone = deviceTimeZone();
  return useQuery({
    queryKey: taskKeys.upcoming(timeZone, weekStart),
    queryFn: () =>
      tasks.list.query({ view: "upcoming", timeZone, weekOf: weekStart }),
  });
}

/** Completions in the week from `weekStart`. */
export function useWeekStats(weekStart: Day, enabled = true) {
  const tasks = useTasksApi();
  const timeZone = deviceTimeZone();
  return useQuery({
    queryKey: taskKeys.stats(timeZone, weekStart),
    queryFn: () => tasks.stats.query({ timeZone, weekOf: weekStart }),
    enabled,
  });
}
