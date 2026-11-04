import { defineServerModule } from "@dlh/server";
import { agentModule } from "./module";

export default defineServerModule(agentModule, {
  migrations: true,
  operations: {},
});
