import { createHash, randomBytes } from "node:crypto";

export const newSessionToken = (): string =>
  randomBytes(32).toString("base64url");
export const hashToken = (token: string): string =>
  createHash("sha256").update(token).digest("hex");
export const newState = (): string => randomBytes(16).toString("base64url");
export const newCodeVerifier = (): string =>
  randomBytes(32).toString("base64url");
export const codeChallengeS256 = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");
