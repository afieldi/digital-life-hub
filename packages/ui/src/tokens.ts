export type ItemType = "task" | "note" | "project" | "event" | "ai";
export type TaskStatus = "todo" | "in_progress" | "review" | "done";

export const typeColors: Record<ItemType, string> = {
  task: "#9FD9A8",
  note: "#F5CF7E",
  project: "#9EC2FF",
  event: "#F5A8A0",
  ai: "#CDB6FF",
};

export const statusColors: Record<"in_progress" | "review", string> = {
  in_progress: "#F5CF7E",
  review: "#9EC2FF",
};
