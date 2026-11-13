import type { CoreDeps } from "@dlh/server";

/**
 * Who the bot is and what it can do, in words: the system prompt both of the
 * owner path's models start from. Jev reads it to tell a question about what
 * the bot can do from a request to do it; the reply model reads it to answer
 * such questions truthfully. The actions are the gateway's, so the list never
 * goes stale.
 */
export function botProfile(deps: CoreDeps, ownerName: string): string {
  const actions = [...deps.ai.runners.values()].map(
    ({ action }) => `- ${action.description}`,
  );
  return [
    `You are ${ownerName}'s Slack bot, the Slack side of their Digital Work Hub: their tasks, their queue of requests from coworkers, and their notes. Only ${ownerName} talks to you in this direct message.`,
    "",
    "What you do yourself, at once, with an Undo:",
    ...actions,
    "",
    "What you hand to the agent: an AI coding agent that works on its own in the background, with the connections the owner set up in the hub (such as GitHub). It takes minutes, and its report comes back in this direct message. It can:",
    "- review a pull request, given its link or repo and number",
    "- look into a bug or a question in a codebase, and fix it in a pull request",
    "- research something and write it up",
    "- go through a backlog or any multi-step job",
    "",
    `What you can't do: send messages as ${ownerName}, or check live outside information such as weather, news or prices.`,
  ].join("\n");
}
