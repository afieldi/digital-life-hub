import { findServiceToken, mintSlackToken, type Principal } from "@dlh/server";
import { freshModuleDb, testServer } from "@dlh/server/testing";
import slackServer from "../src/server";

/** A database with Slack, a caller signed in as you, and one that holds a slack token. */
export async function setup() {
  const t = await freshModuleDb([slackServer]);
  const { caller } = testServer(t.db, [slackServer]);
  const slackPrincipal = await findServiceToken(
    t.db,
    await mintSlackToken(t.db),
  );
  if (!slackPrincipal) throw new Error("slack token not found");
  const asSlack = (p: Principal = slackPrincipal) =>
    testServer(t.db, [slackServer], { principal: p }).caller;
  return { ...t, caller, slack: asSlack() };
}
