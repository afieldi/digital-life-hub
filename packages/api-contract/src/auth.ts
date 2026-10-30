import { z } from "zod";

export const SESSION_DAYS = 90;
export const SESSION_RENEW_AFTER_MS = 3_600_000;
export const LOGIN_ATTEMPT_MS = 600_000;

const LOOPBACK_REDIRECT = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/callback$/;

export const loopbackRedirectUri = z.string().refine((uri) => {
  const match = LOOPBACK_REDIRECT.exec(uri);
  return match !== null && Number(match[1]) <= 65535;
}, "must be http://127.0.0.1:<port>/callback");

export const platform = z.enum(["macos", "windows", "web"]);
export type Platform = z.infer<typeof platform>;

export const deviceInput = z.object({
  name: z.string().trim().min(1).max(100),
  platform,
});
export type DeviceInput = z.infer<typeof deviceInput>;

export const startInput = z.object({ redirectUri: loopbackRedirectUri });
export const startOutput = z.object({ authUrl: z.url(), state: z.string() });

export const exchangeInput = z.object({
  state: z.string().min(1),
  code: z.string().min(1),
  device: deviceInput,
});

export const signInOutput = z.object({ token: z.string() });

export const meOutput = z.object({ email: z.string(), sessionId: z.uuid() });

export const deviceSession = z.object({
  id: z.uuid(),
  name: z.string(),
  platform,
  createdAt: z.iso.datetime(),
  lastUsedAt: z.iso.datetime(),
  current: z.boolean(),
});
export type DeviceSession = z.infer<typeof deviceSession>;

export const revokeInput = z.object({ id: z.uuid() });
