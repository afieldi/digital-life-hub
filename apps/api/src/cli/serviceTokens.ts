import { createDb } from "@dlh/db";
import {
  findServiceToken,
  mintSlackToken,
  mintWorkerToken,
  revokeSlackToken,
  revokeWorkerToken,
} from "@dlh/server";
import { databaseSection, must } from "../config";

const USAGE =
  "Usage: tokens worker|slack create | tokens worker|slack revoke <id>";

const KINDS = {
  worker: { mint: mintWorkerToken, revoke: revokeWorkerToken },
  slack: { mint: mintSlackToken, revoke: revokeSlackToken },
} as const;

const [kind, command, arg] = process.argv.slice(2);
const service = kind === "worker" || kind === "slack" ? KINDS[kind] : null;
const { db, close } = createDb(must(databaseSection(process.env)).url);

try {
  if (service && command === "create") {
    const token = await service.mint(db);
    const principal = await findServiceToken(db, token);
    if (
      (principal?.kind !== "worker" && principal?.kind !== "slack") ||
      principal.kind !== kind
    ) {
      throw new Error(`${kind} token not found`);
    }
    // Only the hash is stored: this is the one time the token is shown.
    console.log(`id     ${principal.tokenId}`);
    console.log(`token  ${token}`);
  } else if (service && command === "revoke" && arg) {
    const ok = await service.revoke(db, arg);
    console.log(`Revoked ${ok ? 1 : 0} ${kind} token(s).`);
    if (!ok) process.exitCode = 1;
  } else {
    console.error(USAGE);
    process.exitCode = 1;
  }
} finally {
  await close();
}
