import type { Platform } from "@dlh/api-contract";

export type SessionRow = {
  id: string;
  tokenHash: string;
  email: string;
  deviceName: string;
  platform: Platform;
  createdAt: Date;
  lastUsedAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
};

export type LoginAttempt = {
  state: string;
  codeVerifier: string;
  redirectUri: string;
  expiresAt: Date;
};

export interface AuthStore {
  /** Also deletes attempts expired at `now`. */
  putLoginAttempt(a: LoginAttempt, now: Date): Promise<void>;
  /** Single use; null if missing or expired. */
  takeLoginAttempt(state: string, now: Date): Promise<LoginAttempt | null>;
  createSession(
    s: Omit<SessionRow, "id" | "createdAt" | "revokedAt">,
    now: Date,
  ): Promise<SessionRow>;
  findSessionByTokenHash(hash: string): Promise<SessionRow | null>;
  touchSession(id: string, lastUsedAt: Date, expiresAt: Date): Promise<void>;
  /** Not revoked, expiresAt > now, lastUsedAt desc. */
  listActiveSessions(now: Date): Promise<SessionRow[]>;
  /** False if missing or already revoked. */
  revokeSession(id: string, now: Date): Promise<boolean>;
}
