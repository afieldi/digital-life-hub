import { type Db, serviceTokens } from "@dlh/db";
import { and, eq, isNull } from "drizzle-orm";
import type { Principal, Tx } from "../trpc";
import { hashToken, newToken } from "./tokens";

/** A new token for the agent host's worker; only its hash is stored. */
export async function mintWorkerToken(db: Db): Promise<string> {
  const token = newToken();
  await db
    .insert(serviceTokens)
    .values({ kind: "worker", tokenHash: hashToken(token) });
  return token;
}

/** False if `id` is no worker token or is already revoked. */
export async function revokeWorkerToken(db: Db, id: string): Promise<boolean> {
  const rows = await db
    .update(serviceTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(serviceTokens.id, id),
        eq(serviceTokens.kind, "worker"),
        isNull(serviceTokens.revokedAt),
      ),
    )
    .returning({ id: serviceTokens.id });
  return rows.length > 0;
}

/** A new token for run `runId`, in the transaction that starts the run. */
export async function mintRunToken(tx: Tx, runId: string): Promise<string> {
  const token = newToken();
  await tx
    .insert(serviceTokens)
    .values({ kind: "run", tokenHash: hashToken(token), runId });
  return token;
}

/** Revokes every live token of run `runId`. */
export async function revokeRunTokens(tx: Tx, runId: string): Promise<void> {
  await tx
    .update(serviceTokens)
    .set({ revokedAt: new Date() })
    .where(
      and(eq(serviceTokens.runId, runId), isNull(serviceTokens.revokedAt)),
    );
}

/** The principal `token` signs in as; null when it is unknown or revoked. */
export async function findServiceToken(
  db: Db,
  token: string,
): Promise<Principal | null> {
  const [row] = await db
    .select()
    .from(serviceTokens)
    .where(eq(serviceTokens.tokenHash, hashToken(token)));
  if (!row || row.revokedAt !== null) return null;
  if (row.kind === "worker") return { kind: "worker", tokenId: row.id };
  if (row.kind === "run" && row.runId) {
    return { kind: "run", tokenId: row.id, runId: row.runId };
  }
  return null;
}
