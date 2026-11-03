import { addDays, type Due } from "@dlh/core";
import type { ItemWriter } from "@dlh/server";
import { createTask } from "./writes";

type SeedTask = {
  title: string;
  /** Days from today (UTC), or null for no date. */
  in: number | null;
  /** A time of day in UTC, `HH:MM`, for a timed task. */
  at?: string;
  priority?: "high";
  notes?: string;
  subtasks?: string[];
};

const TASKS: SeedTask[] = [
  { title: "Renew passport", in: -3, notes: "Photos are in the desk drawer." },
  { title: "Pay the electricity bill", in: -1, priority: "high" },
  {
    title: "Review vendor contracts",
    in: 0,
    subtasks: [
      "List questions for legal",
      "Compare renewal terms",
      "Send summary to finance",
    ],
  },
  { title: "Call the dentist", in: 0, at: "14:00" },
  {
    title: "Plan the weekend trip",
    in: 1,
    subtasks: ["Book the cabin", "Check the weather", "Pack hiking gear"],
  },
  { title: "Water the plants", in: 2 },
  { title: "Prepare the quarterly review", in: 4, priority: "high" },
  { title: "Book a car service", in: 9 },
  { title: "Renew the gym membership", in: 25 },
  { title: "Read Designing Data-Intensive Applications", in: null },
  { title: "Organise the photo library", in: null },
  { title: "Try the new ramen place", in: null },
];

function dueOf(t: SeedTask, today: string): Due | null {
  if (t.in === null) return null;
  const day = addDays(today, t.in);
  return t.at ? { dateTime: `${day}T${t.at}:00Z` } : { date: day };
}

/** 12 tasks from overdue to no date, dated from today in UTC; 2 have 3 subtasks each. */
export async function seed(w: ItemWriter): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  for (const t of TASKS) {
    const task = await createTask(w, { ...t, due: dueOf(t, today) });
    for (const title of t.subtasks ?? []) {
      const sub = await createTask(w, { title });
      await w.addLink({ fromId: task.id, toId: sub.id, kind: "contains" });
    }
  }
}
