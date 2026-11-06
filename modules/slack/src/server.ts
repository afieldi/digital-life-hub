import { defineServerModule, type OperationsRouter } from "@dlh/server";
import { slackModule } from "./module";
import { handleMessage } from "./server/handleMessage";
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
  },
});

/** The `slack` router as the screens call it (type only). */
export type SlackRouter = OperationsRouter<typeof slackServer.operations>;

export default slackServer;
