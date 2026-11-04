import { createHash, randomBytes } from "node:crypto";
import { newToken } from "@dlh/server";

export { hashToken } from "@dlh/server";
export const newSessionToken = newToken;
export const newState = (): string => randomBytes(16).toString("base64url");
export const newCodeVerifier = (): string =>
  randomBytes(32).toString("base64url");
export const codeChallengeS256 = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");
