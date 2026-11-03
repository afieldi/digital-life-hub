import { defineServerModule, type OperationsRouter } from "@dlh/server";

const requestsServer = defineServerModule({
  id: "requests",
  itemTypes: ["request"],
  migrations: true,
  operations: {},
});

/** The `requests` router as the screens call it (type only: no server code in the bundle). */
export type RequestsRouter = OperationsRouter<typeof requestsServer.operations>;

export default requestsServer;
