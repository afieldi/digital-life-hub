import { createApi } from "./api";
import { loadConfig } from "./config";

const config = loadConfig(process.env);
const api = createApi(config);
const stop = api.onChanges(() => {});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stop();
    process.exit(0);
  });
}
console.log(`agent worker listening to ${config.apiUrl}`);
