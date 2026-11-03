import { defineServerModule, type OperationsRouter } from "@dlh/server";
import { get, open, resolved } from "./server/reads";
import { seed } from "./server/seed";
import { file, makeTask, reopen, resolve } from "./server/writes";

const requestsServer = defineServerModule({
  id: "requests",
  itemTypes: ["request"],
  migrations: true,
  seed,
  operations: { file, resolve, makeTask, reopen, open, resolved, get },
});

/** The `requests` router as the screens call it (type only: no server code in the bundle). */
export type RequestsRouter = OperationsRouter<typeof requestsServer.operations>;

export default requestsServer;
