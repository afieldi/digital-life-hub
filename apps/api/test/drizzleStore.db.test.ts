import { freshTestDb } from "@dlh/db/testing";
import { drizzleAuthStore } from "../src/auth/drizzleStore";
import { describeAuthStore } from "./storeContract";

describeAuthStore("drizzle", async () => {
  const t = await freshTestDb();
  return { store: drizzleAuthStore(t.db), done: t.close };
});
