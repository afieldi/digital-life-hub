export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export const statusColors: Record<"in_progress" | "review", string> = {
  in_progress: "#F5CF7E",
  review: "#9EC2FF",
};
