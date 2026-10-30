import type { Platform } from "@dlh/api-contract";
import { type Db, loginAttempts, sessions } from "@dlh/db";
import { and, desc, eq, gt, isNull, lte } from "drizzle-orm";
import type { AuthStore, SessionRow } from "./store";

type DbSession = typeof sessions.$inferSelect;

const toRow = (r: DbSession): SessionRow => ({
  ...r,
  platform: r.platform as Platform,
});

export function drizzleAuthStore(db: Db): AuthStore {
  return {
    async putLoginAttempt(a, now) {
      await db.delete(loginAttempts).where(lte(loginAttempts.expiresAt, now));
      await db.insert(loginAttempts).values(a);
    },

    async takeLoginAttempt(state, now) {
      const [row] = await db
        .delete(loginAttempts)
        .where(eq(loginAttempts.state, state))
        .returning();
      return row && row.expiresAt > now ? row : null;
    },

    async createSession(s, now) {
      const [row] = await db
        .insert(sessions)
        .values({ ...s, createdAt: now })
        .returning();
      if (!row) throw new Error("insert returned no row");
      return toRow(row);
    },

    async findSessionByTokenHash(hash) {
      const [row] = await db
        .select()
        .from(sessions)
        .where(eq(sessions.tokenHash, hash));
      return row ? toRow(row) : null;
    },

    async touchSession(id, lastUsedAt, expiresAt) {
      await db
        .update(sessions)
        .set({ lastUsedAt, expiresAt })
        .where(eq(sessions.id, id));
    },

    async listActiveSessions(now) {
      const rows = await db
        .select()
        .from(sessions)
        .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, now)))
        .orderBy(desc(sessions.lastUsedAt));
      return rows.map(toRow);
    },

    async revokeSession(id, now) {
      const rows = await db
        .update(sessions)
        .set({ revokedAt: now })
        .where(and(eq(sessions.id, id), isNull(sessions.revokedAt)))
        .returning({ id: sessions.id });
      return rows.length > 0;
    },
  };
}
