import { defineServerModule, type OperationsRouter } from "@dlh/server";
import { requestsModule } from "./module";
import { fromSender, get, open, resolved } from "./server/reads";
import { seed } from "./server/seed";
import { append, file, makeTask, reopen, resolve } from "./server/writes";

const requestsServer = defineServerModule(requestsModule, {
  migrations: true,
  seed,
  operations: {
    file,
    resolve,
    makeTask,
    reopen,
    open,
    resolved,
    get,
    append,
    fromSender,
  },
});

/** The `requests` router as the screens call it (type only: no server code in the bundle). */
export type RequestsRouter = OperationsRouter<typeof requestsServer.operations>;

export default requestsServer;
