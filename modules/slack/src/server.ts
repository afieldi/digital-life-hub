import { defineServerModule, type OperationsRouter } from "@dlh/server";
import { slackModule } from "./module";
import { handleAction } from "./server/actions";
import { dismissEscalation, runEscalated } from "./server/escalation";
import { handleMessage } from "./server/handleMessage";
import { markFailed, markSent, pendingSends } from "./server/outbox";
import { people, setGithubLogin, upsertPerson } from "./server/people";
import { botSettings, setSettings, settingsQuery } from "./server/settings";

const slackServer = defineServerModule(slackModule, {
  migrations: true,
  operations: {
    settings: settingsQuery,
    setSettings,
    people,
    setGithubLogin,
    botSettings,
    upsertPerson,
    handleMessage,
    handleAction,
    pendingSends,
    markSent,
    markFailed,
    runEscalated,
    dismissEscalation,
  },
});

/** The `slack` router as the screens call it (type only). */
export type SlackRouter = OperationsRouter<typeof slackServer.operations>;

export default slackServer;
