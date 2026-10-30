import { randomUUID } from "node:crypto";
import type { AuthStore, LoginAttempt, SessionRow } from "./store";

export function memoryAuthStore(): AuthStore {
  const attempts = new Map<string, LoginAttempt>();
  const sessions = new Map<string, SessionRow>();

  return {
    async putLoginAttempt(a, now) {
      for (const [state, existing] of attempts) {
        if (existing.expiresAt <= now) attempts.delete(state);
      }
      attempts.set(a.state, { ...a });
    },
    async takeLoginAttempt(state, now) {
      const a = attempts.get(state);
      if (!a) return null;
      attempts.delete(state);
      return a.expiresAt > now ? a : null;
    },
    async createSession(s, now) {
      const row: SessionRow = {
        ...s,
        id: randomUUID(),
        createdAt: now,
        revokedAt: null,
      };
      sessions.set(row.id, row);
      return { ...row };
    },
    async findSessionByTokenHash(hash) {
      for (const row of sessions.values()) {
        if (row.tokenHash === hash) return { ...row };
      }
      return null;
    },
    async touchSession(id, lastUsedAt, expiresAt) {
      const row = sessions.get(id);
      if (row) sessions.set(id, { ...row, lastUsedAt, expiresAt });
    },
    async listActiveSessions(now) {
      return [...sessions.values()]
        .filter((s) => s.revokedAt === null && s.expiresAt > now)
        .sort((a, b) => b.lastUsedAt.getTime() - a.lastUsedAt.getTime())
        .map((s) => ({ ...s }));
    },
    async revokeSession(id, now) {
      const row = sessions.get(id);
      if (!row || row.revokedAt) return false;
      sessions.set(id, { ...row, revokedAt: now });
      return true;
    },
  };
}
