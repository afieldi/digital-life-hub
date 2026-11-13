import { defineServerModule, type OperationsRouter } from "@dlh/server";
import { agentModule } from "./module";
import { assign, assignRequest, unassign } from "./server/assign";
import {
  connectionsQuery,
  disableConnection,
  setDefaultConnections,
} from "./server/connections";
import { runGuard } from "./server/guard";
import { events, recentRuns, run, runSource, runs } from "./server/reads";
import { cancel, decide, dismiss, message, retry } from "./server/runs";
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
  runGuard,
  operations: {
    assign,
    assignRequest,
    unassign,
    message,
    cancel,
    retry,
    dismiss,
    decide,
    run,
    runs,
    recentRuns,
    runSource,
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
/** What `agent.claim` hands the worker (type only). */
export type { ClaimResult } from "./server/worker";

export default agentServer;
