import { defineServerModule } from "@dlh/server";

export default defineServerModule({
  id: "tasks",
  itemTypes: ["task"],
  migrations: true,
  operations: {},
});
