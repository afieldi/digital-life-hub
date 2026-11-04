import { createDb } from "@dlh/db";
import {
  findServiceToken,
  mintWorkerToken,
  revokeWorkerToken,
} from "@dlh/server";
import { databaseSection, must } from "../config";

const USAGE = "Usage: tokens worker create | tokens worker revoke <id>";

const [kind, command, arg] = process.argv.slice(2);
const { db, close } = createDb(must(databaseSection(process.env)).url);

try {
  if (kind === "worker" && command === "create") {
    const token = await mintWorkerToken(db);
    const principal = await findServiceToken(db, token);
    if (principal?.kind !== "worker") throw new Error("worker token not found");
    // Only the hash is stored: this is the one time the token is shown.
    console.log(`id     ${principal.tokenId}`);
    console.log(`token  ${token}`);
  } else if (kind === "worker" && command === "revoke" && arg) {
    const ok = await revokeWorkerToken(db, arg);
    console.log(`Revoked ${ok ? 1 : 0} worker token(s).`);
    if (!ok) process.exitCode = 1;
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} finally {
  await close();
}
