import type { Phrasing } from "@dlh/core/testing";

const REQUEST = "request";

const p = (
  text: string,
  actionId: string,
  kind: Phrasing["kind"],
  itemType: string | null = REQUEST,
): Phrasing => ({ text, itemType, actionId, kind });

/**
 * Labelled phrasings for Queue's AI actions: text, item on screen, expected
 * action and kind. Near-misses: "remind me to look at…" files a request, where
 * "remind me to…" adds a task; Make task (a new task from the request) against
 * Tasks' create; Resolve's outcomes against Core's delete.
 */
export const requestsPhrasings: Phrasing[] = [
  // file
  p("file this", "requests.file", "do", null),
  p("file this: Sam wants the Q3 numbers", "requests.file", "do", null),
  p("remind me to look at the contract", "requests.file", "do", null),
  p("remind me to look at Dana's pull request", "requests.file", "do", null),
  p("file a request to review the budget", "requests.file", "do", null),
  p("add this to my queue: reply to the landlord", "requests.file", "do", null),
  p("can you file this for me?", "requests.file", "do", null),
  p("file it for later", "requests.file", "do", null),
  p("remind me to look at this", "requests.file", "do", "task"),

  // open
  p("what's waiting on me?", "requests.open", "ask", null),
  p("what's waiting for me", "requests.open", "ask", null),
  p("show my queue", "requests.open", "ask", null),
  p("what needs me?", "requests.open", "ask", null),
  p("anything waiting on me?", "requests.open", "ask", null),
  p("list my open requests", "requests.open", "ask", null),
  p("do I have any requests waiting?", "requests.open", "ask", null),
  p("what's in my queue?", "requests.open", "ask", null),
  p("what's waiting on me?", "requests.open", "ask"),

  // makeTask
  p("make a task from this", "requests.makeTask", "do"),
  p("make task", "requests.makeTask", "do"),
  p("turn this into a task", "requests.makeTask", "do"),
  p("make this a task", "requests.makeTask", "do"),
  p("create a task from this request", "requests.makeTask", "do"),
  p("add this as a task", "requests.makeTask", "do"),
  p("can you make a task out of this?", "requests.makeTask", "do"),
  p("make this a task due friday", "requests.makeTask", "do"),
  p("suggest a task for this", "requests.makeTask", "suggest"),

  // resolve
  p("handled", "requests.resolve", "do"),
  p("done with this", "requests.resolve", "do"),
  p("not for me", "requests.resolve", "do"),
  p("ignore this", "requests.resolve", "do"),
  p("ignore it", "requests.resolve", "do"),
  p("mark this as handled", "requests.resolve", "do"),
  p("please mark this as handled", "requests.resolve", "do"),
  p("dismiss this", "requests.resolve", "do"),
  p("resolve this as handled", "requests.resolve", "do"),
  p("done with this one", "requests.resolve", "do"),

  // Core's retitle and delete on a request
  p("rename this request", "retitle", "do"),
  p("give this a better title", "retitle", "do"),
  p("delete this request", "delete", "suggest"),
];
