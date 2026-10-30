import { memoryAuthStore } from "../src/auth/memoryStore";
import { describeAuthStore } from "./storeContract";

describeAuthStore("memory", async () => ({
  store: memoryAuthStore(),
  done: async () => {},
}));
