import {
  defineServerModule,
  type ImplementedOperation,
  type MutationImpl,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { agentModule } from "./module";
import { agentOps } from "./operations";

const notYet = () => {
  throw new TRPCError({
    code: "NOT_IMPLEMENTED",
    message: "Not implemented yet",
  });
};

/** Placeholder until the operation is built (Tasks 9-11 replace each one). */
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
    assign: stub(agentOps.assign),
    assignRequest: stub(agentOps.assignRequest),
    unassign: stub(agentOps.unassign),
    message: stub(agentOps.message),
    cancel: stub(agentOps.cancel),
    retry: stub(agentOps.retry),
    decide: stub(agentOps.decide),
    run: stub(agentOps.run),
    runs: stub(agentOps.runs),
    events: stub(agentOps.events),
    connections: stub(agentOps.connections),
    setDefaultConnections: stub(agentOps.setDefaultConnections),
    disableConnection: stub(agentOps.disableConnection),
    settings: stub(agentOps.settings),
    setSettings: stub(agentOps.setSettings),
    claim: stub(agentOps.claim),
    heartbeat: stub(agentOps.heartbeat),
    appendEvents: stub(agentOps.appendEvents),
    takeMessages: stub(agentOps.takeMessages),
    suspend: stub(agentOps.suspend),
    finish: stub(agentOps.finish),
    fail: stub(agentOps.fail),
    registerConnection: stub(agentOps.registerConnection),
  },
});
