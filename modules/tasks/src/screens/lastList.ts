import { useSearch } from "@tanstack/react-router";

/** The Tasks list screens, by path. */
export type TaskListPath = "/tasks" | "/tasks/upcoming" | "/tasks/done";

/**
 * A list's view state, kept in its URL so it survives the list remounting
 * (behind the Detail panel, or on Back): Upcoming's `week` (any day of it)
 * and Open's High-only `high`.
 */
export type ListSearch = { week?: string; high?: boolean };

/** A list's search params as the router hands them over, cleaned up. */
export function parseListSearch(raw: Record<string, unknown>): ListSearch {
  return {
    ...(typeof raw.week === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.week)
      ? { week: raw.week }
      : {}),
    ...(raw.high === true || raw.high === "true" ? { high: true } : {}),
  };
}

/** The search a list shows: given (behind Detail), else its own URL's. */
export function useListSearch(given?: ListSearch): ListSearch {
  const own = useSearch({ strict: false }) as Record<string, unknown>;
  return given ?? parseListSearch(own);
}

export type ListLocation = { path: TaskListPath; search: ListSearch };

const OPEN: ListLocation = { path: "/tasks", search: {} };
let last: ListLocation = OPEN;

/**
 * The list screen shown last, with its view state, so the Detail panel opens
 * over it and closing goes back to it. Open until another list is seen.
 */
export const lastList = (): ListLocation => last;

export function rememberList(location: ListLocation) {
  last = location;
}

/** Back to Open, for when no list is on screen any more. */
export function forgetList() {
  last = OPEN;
}
