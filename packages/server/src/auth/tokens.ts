import { createHash, randomBytes } from "node:crypto";

/** A random 32-byte base64url bearer token. */
export const newToken = (): string => randomBytes(32).toString("base64url");

/** What's stored of a token: its SHA-256, hex. */
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
