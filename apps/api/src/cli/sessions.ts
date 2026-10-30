import { createDb, DEFAULT_DATABASE_URL } from "@dlh/db";
import { drizzleAuthStore } from "../auth/drizzleStore";

const USAGE =
  "Usage: sessions list | sessions revoke <id> | sessions revoke --all";

const [command, arg] = process.argv.slice(2);
const { db, close } = createDb(
  process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
);
const store = drizzleAuthStore(db);
const now = new Date();

try {
  if (command === "list") {
    const rows = await store.listActiveSessions(now);
    console.log("id  device  platform  last used");
    for (const r of rows) {
      console.log(
        `${r.id}  ${r.deviceName}  ${r.platform}  ${r.lastUsedAt.toISOString()}`,
      );
    }
  } else if (command === "revoke" && arg === "--all") {
    let count = 0;
    for (const r of await store.listActiveSessions(now)) {
      if (await store.revokeSession(r.id, now)) count++;
    }
    console.log(`Revoked ${count} session(s).`);
  } else if (command === "revoke" && arg) {
    const ok = await store.revokeSession(arg, now);
    console.log(`Revoked ${ok ? 1 : 0} session(s).`);
    if (!ok) process.exitCode = 1;
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} finally {
  await close();
}
