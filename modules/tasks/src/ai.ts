import { describeAiAction } from "@dlh/core";

/** Tasks' hand-written AI actions, shared by the manifest and the server runners. */
export const tasksAiActions = {
  breakDown: describeAiAction({
    id: "tasks.breakDown",
    label: "Break down",
    description:
      "Splits the task into 3 to 7 subtasks, from its title, notes and the subtasks it already has. Use when the person wants steps or subtasks for the task on screen. Not for making this task a subtask of another.",
    appliesTo: ["task"],
    kinds: ["suggest", "do"],
    effects: ["createItems", "addLinks"],
    words: ["break down", "break", "split", "steps", "subtasks", "checklist"],
  }),
  rewriteNotes: describeAiAction({
    id: "tasks.rewriteNotes",
    label: "Rewrite notes",
    description:
      "Rewrites the task's notes more clearly, without adding facts. Use when the person wants the notes cleaned up or reworded. Not for writing notes the person dictates, or for the title.",
    appliesTo: ["task"],
    kinds: ["suggest", "do"],
    effects: ["updateItem"],
    words: ["notes", "note", "reword", "wording", "rewrite the notes"],
  }),
  planToday: describeAiAction({
    id: "tasks.planToday",
    label: "Plan today",
    description:
      "Orders today's work: overdue tasks, today's and the next two days', with a reason for each and one line of advice. Use when the person asks what to do first or wants a plan for the day.",
    appliesTo: ["none", "*"],
    kinds: ["ask"],
    effects: [],
    words: [
      "plan",
      "my day",
      "focus",
      "prioritise",
      "prioritize",
      "triage",
      "should i do",
      "where do i start",
    ],
  }),
};
