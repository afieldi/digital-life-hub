import { findServiceToken, mintSlackToken, type Principal } from "@dlh/server";
import { freshModuleDb, testServer } from "@dlh/server/testing";
import requestsServer from "../../requests/src/server";
import tasksServer from "../../tasks/src/server";
import slackServer from "../src/server";

// Slack's calls reach Requests, whose operations in turn reach Tasks.
const modules = [tasksServer, requestsServer, slackServer] as const;

/** A database with Slack, Requests and Tasks, a caller signed in as you, and one that holds a slack token. */
export async function setup() {
  const t = await freshModuleDb(modules);
  const { caller, deps } = testServer(t.db, modules);
  const slackPrincipal = await findServiceToken(
    t.db,
    await mintSlackToken(t.db),
  );
  if (!slackPrincipal) throw new Error("slack token not found");
  const asSlack = (p: Principal = slackPrincipal) =>
    testServer(t.db, modules, { principal: p });
  const { caller: slack, deps: slackDeps } = asSlack();
  return { ...t, caller, deps, slack, slackDeps };
}
