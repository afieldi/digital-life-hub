import type { Phrasing } from "@dlh/core/testing";

const p = (
  text: string,
  actionId: string,
  kind: Phrasing["kind"],
  itemType: string | null = "task",
): Phrasing => ({ text, itemType, actionId, kind });

/**
 * Labelled phrasings for Agent's AI actions: text, item on screen, expected
 * action and kind. Near-misses: `assign` (the task on screen to the agent)
 * against Tasks' create and update; `assignRequest` (a request to the agent)
 * against Queue's makeTask; `cancel` and `retry` (a run) against Core's delete
 * and Tasks' reopen. Kinds are what the effects allow: every
 * action here touches items, so each stops at `suggest`.
 */
export const agentPhrasings: Phrasing[] = [
  // assign
  p("give this to the agent", "agent.assign", "suggest"),
  p("make this an AI task", "agent.assign", "suggest"),
  p("let the agent do this", "agent.assign", "suggest"),
  p("have the agent handle this task", "agent.assign", "suggest"),
  p("assign this to the agent", "agent.assign", "suggest"),
  p("hand this task to the agent", "agent.assign", "suggest"),
  p("delegate this to the agent", "agent.assign", "suggest"),
  p("can the agent take this one?", "agent.assign", "suggest"),
  p("send this to the AI agent", "agent.assign", "suggest"),

  // assignRequest
  p(
    "give this request to the agent",
    "agent.assignRequest",
    "suggest",
    "request",
  ),
  p(
    "have the agent deal with this",
    "agent.assignRequest",
    "suggest",
    "request",
  ),
  p(
    "let the agent handle this request",
    "agent.assignRequest",
    "suggest",
    "request",
  ),
  p("hand this to the agent", "agent.assignRequest", "suggest", "request"),
  p(
    "delegate this request to the agent",
    "agent.assignRequest",
    "suggest",
    "request",
  ),
  p(
    "assign this request to the agent",
    "agent.assignRequest",
    "suggest",
    "request",
  ),
  p("pass this on to the agent", "agent.assignRequest", "suggest", "request"),
  p("send this to the AI agent", "agent.assignRequest", "suggest", "request"),

  // unassign
  p("take this back from the agent", "agent.unassign", "suggest"),
  p("back to me", "agent.unassign", "suggest"),
  p("I'll do this one myself", "agent.unassign", "suggest"),
  p("unassign this from the agent", "agent.unassign", "suggest"),
  p("take this task back", "agent.unassign", "suggest"),
  p("stop the agent and give it back to me", "agent.unassign", "suggest"),
  p("don't let the agent do this, I will", "agent.unassign", "suggest"),
  p("make this my task again", "agent.unassign", "suggest"),

  // cancel
  p("cancel the agent's run", "agent.cancel", "suggest"),
  p("stop the agent", "agent.cancel", "suggest"),
  p("cancel this run", "agent.cancel", "suggest"),
  p("stop the run", "agent.cancel", "suggest"),
  p("abort the agent run", "agent.cancel", "suggest"),
  p("halt the agent", "agent.cancel", "suggest"),
  p("tell the agent to stop working on this", "agent.cancel", "suggest"),
  p("kill the agent's run on this task", "agent.cancel", "suggest"),

  // retry
  p("retry the agent's run", "agent.retry", "suggest"),
  p("try the run again", "agent.retry", "suggest"),
  p("run the agent again", "agent.retry", "suggest"),
  p("restart the agent on this", "agent.retry", "suggest"),
  p("retry this run", "agent.retry", "suggest"),
  p("have the agent try again", "agent.retry", "suggest"),
  p("resume the failed run", "agent.retry", "suggest"),
  p("run it again", "agent.retry", "suggest"),
];
