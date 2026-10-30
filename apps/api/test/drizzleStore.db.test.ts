import { freshTestDb } from "@dlh/db";
import { drizzleAuthStore } from "../src/auth/drizzleStore";
import { describeAuthStore } from "./storeContract";

describeAuthStore("drizzle", async () => {
  const t = await freshTestDb();
  return { store: drizzleAuthStore(t.db), done: t.close };
});
