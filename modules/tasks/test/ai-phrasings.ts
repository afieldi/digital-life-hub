import type { Phrasing } from "@dlh/core/testing";

const TASK = "task";

const p = (
  text: string,
  actionId: string,
  kind: Phrasing["kind"],
  itemType: string | null = TASK,
): Phrasing => ({ text, itemType, actionId, kind });

/**
 * Labelled phrasings for Tasks' AI actions: text, item on screen, expected
 * action and kind. Near-misses between the actions that all change the task on
 * screen: `reschedule` (only the due date), `rewriteNotes` (only the notes),
 * Core's `retitle` (only the title) and `update` (priority, or several fields).
 */
export const tasksPhrasings: Phrasing[] = [
  // create
  p("add a task to call the bank", "tasks.create", "do", null),
  p("add buy milk to my list", "tasks.create", "do", null),
  p("remind me to water the plants tomorrow", "tasks.create", "do", null),
  p("new task: renew passport", "tasks.create", "do", null),
  p("create a todo for the dentist appointment", "tasks.create", "do", null),
  p("add a to-do: email Sam", "tasks.create", "do"),
  p("can you add a reminder to pay rent on friday", "tasks.create", "do", null),
  p("put book flights on my todo list", "tasks.create", "do", null),
  p("add a high priority task to file taxes", "tasks.create", "do", null),

  // update: priority, or several fields at once
  p("set the priority to high", "tasks.update", "do"),
  p("make this high priority", "tasks.update", "do"),
  p("make it medium priority", "tasks.update", "do"),
  p("edit this task", "tasks.update", "do"),
  p("edit the due date and priority", "tasks.update", "do"),
  p("set the notes to: call after 5pm", "tasks.update", "do"),
  p(
    "set the title to Call the bank and make it high priority",
    "tasks.update",
    "do",
  ),
  p("update the details of this task", "tasks.update", "do"),
  p("what priority should this be?", "tasks.update", "suggest"),

  // complete
  p("mark this done", "tasks.complete", "do"),
  p("done", "tasks.complete", "do"),
  p("finish this", "tasks.complete", "do"),
  p("tick this off", "tasks.complete", "do"),
  p("check this off", "tasks.complete", "do"),
  p("complete this task", "tasks.complete", "do"),
  p("please mark it as done", "tasks.complete", "do"),
  p("can you tick this off?", "tasks.complete", "do"),

  // reopen
  p("reopen this", "tasks.reopen", "do"),
  p("uncheck this", "tasks.reopen", "do"),
  p("untick it", "tasks.reopen", "do"),
  p("reopen the task", "tasks.reopen", "do"),
  p("open this again", "tasks.reopen", "do"),
  p("please reopen it", "tasks.reopen", "do"),
  p("mark this undone", "tasks.reopen", "do"),
  p("can you reopen this?", "tasks.reopen", "do"),

  // reschedule: only the due date
  p("move this to friday", "tasks.reschedule", "do"),
  p("postpone to next week", "tasks.reschedule", "do"),
  p("push it to tomorrow", "tasks.reschedule", "do"),
  p("reschedule for monday", "tasks.reschedule", "do"),
  p("change the due date to the 15th", "tasks.reschedule", "do"),
  p("can you move this to next tuesday", "tasks.reschedule", "do"),
  p("make it due on friday", "tasks.reschedule", "do"),
  p("push this back a week", "tasks.reschedule", "do"),
  p("suggest a new date for this", "tasks.reschedule", "suggest"),

  // reorder
  p("move this to the top", "tasks.reorder", "do"),
  p("put it at the bottom", "tasks.reorder", "do"),
  p("move to the bottom of the list", "tasks.reorder", "do"),
  p("reorder this", "tasks.reorder", "do"),
  p("bring this to the top", "tasks.reorder", "do"),
  p("put this first in the list", "tasks.reorder", "do"),
  p("move it up to the top of my list", "tasks.reorder", "do"),
  p("can you move this to the top?", "tasks.reorder", "do"),

  // addParent
  p("make this a subtask of Groceries", "tasks.addParent", "do"),
  p("nest this under Groceries", "tasks.addParent", "do"),
  p("put this under the Trip task", "tasks.addParent", "do"),
  p("set the parent to Groceries", "tasks.addParent", "do"),
  p("add this as a subtask of Groceries", "tasks.addParent", "do"),
  p("can you nest this inside Groceries?", "tasks.addParent", "do"),
  p("make it a child of the Trip task", "tasks.addParent", "do"),
  p("this belongs under the Groceries task", "tasks.addParent", "suggest"),

  // removeParent
  p("remove this from its parent", "tasks.removeParent", "do"),
  p("unnest this", "tasks.removeParent", "do"),
  p("detach from Groceries", "tasks.removeParent", "do"),
  p("take this out of Groceries", "tasks.removeParent", "do"),
  p("remove the parent", "tasks.removeParent", "do"),
  p("detach this from its parent task", "tasks.removeParent", "do"),
  p("please unnest it", "tasks.removeParent", "do"),
  p("make this a top-level task", "tasks.removeParent", "do"),

  // due
  p("what's due friday?", "tasks.due", "ask", null),
  p("what's due this week", "tasks.due", "ask", null),
  p("show my agenda for tomorrow", "tasks.due", "ask", null),
  p("due today", "tasks.due", "ask", null),
  p("any deadlines this week?", "tasks.due", "ask", null),
  p("what's due tomorrow?", "tasks.due", "ask"),
  p("what do I have due next week", "tasks.due", "ask", null),
  p("list tasks due on monday", "tasks.due", "ask", null),
  p("agenda for this week", "tasks.due", "ask", null),

  // breakDown
  p("break this into subtasks", "tasks.breakDown", "do"),
  p("break it down", "tasks.breakDown", "do"),
  p("split this into steps", "tasks.breakDown", "do"),
  p("suggest subtasks for this", "tasks.breakDown", "suggest"),
  p("what are the steps for this?", "tasks.breakDown", "suggest"),
  p("break this task down into smaller steps", "tasks.breakDown", "do"),
  p("give me a checklist for this", "tasks.breakDown", "do"),
  p("can you split this up?", "tasks.breakDown", "do"),
  p("ideas for subtasks", "tasks.breakDown", "suggest"),

  // rewriteNotes: only the notes, rewritten by the model
  p("rewrite the notes", "tasks.rewriteNotes", "do"),
  p("clean up the notes", "tasks.rewriteNotes", "do"),
  p("tidy up my notes on this", "tasks.rewriteNotes", "do"),
  p("make the notes clearer", "tasks.rewriteNotes", "do"),
  p("rewrite the notes more clearly", "tasks.rewriteNotes", "do"),
  p("reword the notes", "tasks.rewriteNotes", "do"),
  p("suggest a clearer version of the notes", "tasks.rewriteNotes", "suggest"),
  p("options for rewriting the notes", "tasks.rewriteNotes", "suggest"),
  p("fix the wording of the notes", "tasks.rewriteNotes", "do"),
  p("can you rewrite these notes?", "tasks.rewriteNotes", "do"),

  // planToday
  p("plan my day", "tasks.planToday", "ask", null),
  p("what should I do first today?", "tasks.planToday", "ask", null),
  p("help me plan today", "tasks.planToday", "ask", null),
  p("what should I focus on today?", "tasks.planToday", "ask", null),
  p("prioritise my tasks for today", "tasks.planToday", "ask", null),
  p("how should I order my day?", "tasks.planToday", "ask", null),
  p("plan my day", "tasks.planToday", "ask"),
  p("where do I start today?", "tasks.planToday", "ask", null),
  p("triage my tasks for today", "tasks.planToday", "ask"),

  // Core's retitle and delete on a task: only the title, or the whole task
  p("rename this task", "retitle", "do"),
  p("give this task a better title", "retitle", "do"),
  p("change the title", "retitle", "do"),
  p("rewrite the title", "retitle", "do"),
  p("make the title shorter", "retitle", "do"),
  p("suggest a few titles", "retitle", "suggest"),
  p("what would be a good title for this task", "retitle", "suggest"),
  p("rename it to Call the bank", "retitle", "do"),
  p("delete this task", "delete", "suggest"),
];
