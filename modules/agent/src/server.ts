import {
  defineServerModule,
  type ImplementedOperation,
  type MutationImpl,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { agentModule } from "./module";
import { agentOps } from "./operations";
import { assign, assignRequest, unassign } from "./server/assign";
import {
  connectionsQuery,
  disableConnection,
  setDefaultConnections,
} from "./server/connections";
import { events, run, runs } from "./server/reads";
import { cancel, message, retry } from "./server/runs";
import { setSettings, settingsQuery } from "./server/settings";
import { claim } from "./server/worker";

const notYet = () => {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Not implemented yet",
  });
};

/** Placeholder until the operation is built (Tasks 10-11 replace each one). */
function stub<D extends (typeof agentOps)[keyof typeof agentOps]>(
  desc: D,
): ImplementedOperation<D> {
  const impl: MutationImpl<unknown, never, null> = {
    run: async () => notYet(),
    undo: async () => {},
    undoRecord: z.null(),
  };
  return (
    desc.kind === "query"
      ? { kind: "query", desc, impl: { run: async () => notYet() } }
      : { kind: "mutation", desc, impl }
  ) as ImplementedOperation<D>;
}

export default defineServerModule(agentModule, {
  migrations: true,
  operations: {
    assign,
    assignRequest,
    unassign,
    message,
    cancel,
    retry,
    decide: stub(agentOps.decide),
    run,
    runs,
    events,
    connections: connectionsQuery,
    setDefaultConnections,
    disableConnection,
    settings: settingsQuery,
    setSettings,
    claim,
    heartbeat: stub(agentOps.heartbeat),
    appendEvents: stub(agentOps.appendEvents),
    takeMessages: stub(agentOps.takeMessages),
    suspend: stub(agentOps.suspend),
    finish: stub(agentOps.finish),
    fail: stub(agentOps.fail),
    registerConnection: stub(agentOps.registerConnection),
  },
});
