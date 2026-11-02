/** The Tasks list screens, by path. */
export type TaskListPath = "/tasks" | "/tasks/upcoming" | "/tasks/done";

let last: TaskListPath = "/tasks";

/**
 * The list screen shown last, so the Detail panel opens over it and closing
 * goes back to it. Per app session; Open until another list is seen.
 */
export const lastList = (): TaskListPath => last;

export function rememberList(path: TaskListPath) {
  last = path;
}
