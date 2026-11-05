import { createApi } from "./api";
import { createClaimLoop } from "./claimLoop";
import { loadConfig } from "./config";
import { cliDocker, execFile } from "./docker/cli";
import { createPrices } from "./relay/prices";
import { openStore } from "./store";

const config = loadConfig(process.env);
const store = openStore(config.dataDir, config.secretsKey);
const loop = createClaimLoop({
  api: createApi(config),
  docker: cliDocker(execFile, { dataDir: config.dataDir }),
  store,
  dataDir: config.dataDir,
  image: config.image,
  relay: {
    gatewayUrl: config.gatewayUrl,
    gatewayKey: config.gatewayKey,
    prices: createPrices(fetch, Date.now),
  },
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    void loop.stop().finally(() => {
      store.close();
      process.exit(0);
    });
  });
}
await loop.start();
console.log(`agent worker listening to ${config.apiUrl}`);
