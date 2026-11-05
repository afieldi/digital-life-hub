import { defineServerModule, type OperationsRouter } from "@dlh/server";
import { agentModule } from "./module";
import { assign, assignRequest, unassign } from "./server/assign";
import {
  connectionsQuery,
  disableConnection,
  setDefaultConnections,
} from "./server/connections";
import { events, run, runs } from "./server/reads";
import { cancel, decide, message, retry } from "./server/runs";
import { setSettings, settingsQuery } from "./server/settings";
import {
  appendEvents,
  claim,
  fail,
  finish,
  heartbeat,
  registerConnection,
  suspend,
  takeMessages,
} from "./server/worker";

const agentServer = defineServerModule(agentModule, {
  migrations: true,
  operations: {
    assign,
    assignRequest,
    unassign,
    message,
    cancel,
    retry,
    decide,
    run,
    runs,
    events,
    connections: connectionsQuery,
    setDefaultConnections,
    disableConnection,
    settings: settingsQuery,
    setSettings,
    claim,
    heartbeat,
    appendEvents,
    takeMessages,
    suspend,
    finish,
    fail,
    registerConnection,
  },
});

/** The `agent` router as the host worker calls it (type only: no server code in the bundle). */
export type AgentRouter = OperationsRouter<typeof agentServer.operations>;

export default agentServer;
