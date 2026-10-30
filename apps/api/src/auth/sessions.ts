import { SESSION_DAYS, SESSION_RENEW_AFTER_MS } from "@dlh/api-contract";
import type { AuthStore, SessionRow } from "./store";
import { hashToken } from "./tokens";

const DAY_MS = 86_400_000;

export const sessionExpiry = (now: Date): Date =>
  new Date(now.getTime() + SESSION_DAYS * DAY_MS);

export async function authenticate(
  store: AuthStore,
  token: string,
  now: Date,
): Promise<SessionRow | null> {
  const row = await store.findSessionByTokenHash(hashToken(token));
  if (!row || row.revokedAt !== null || row.expiresAt <= now) return null;
  if (now.getTime() - row.lastUsedAt.getTime() < SESSION_RENEW_AFTER_MS)
    return row;
  const expiresAt = sessionExpiry(now);
  await store.touchSession(row.id, now, expiresAt);
  return { ...row, lastUsedAt: now, expiresAt };
}
