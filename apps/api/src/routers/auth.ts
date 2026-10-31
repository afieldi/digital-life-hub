import type { DeviceInput } from "@dlh/api-contract";
import {
  deviceInput,
  exchangeInput,
  LOGIN_ATTEMPT_MS,
  meOutput,
  signInOutput,
  startInput,
  startOutput,
} from "@dlh/api-contract";
import { protectedProcedure, publicProcedure, router } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sessionExpiry } from "../auth/sessions";
import {
  codeChallengeS256,
  hashToken,
  newCodeVerifier,
  newSessionToken,
  newState,
} from "../auth/tokens";
import type { AppDeps } from "../trpc";

async function issueSession(
  deps: AppDeps,
  email: string,
  device: DeviceInput,
): Promise<{ token: string }> {
  const now = deps.now();
  const token = newSessionToken();
  await deps.store.createSession(
    {
      tokenHash: hashToken(token),
      email,
      deviceName: device.name,
      platform: device.platform,
      lastUsedAt: now,
      expiresAt: sessionExpiry(now),
    },
    now,
  );
  return { token };
}

export const authRouter = router({
  start: publicProcedure
    .input(startInput)
    .output(startOutput)
    .mutation(async ({ ctx, input }) => {
      const now = ctx.deps.now();
      const state = newState();
      const codeVerifier = newCodeVerifier();
      await ctx.deps.store.putLoginAttempt(
        {
          state,
          codeVerifier,
          redirectUri: input.redirectUri,
          expiresAt: new Date(now.getTime() + LOGIN_ATTEMPT_MS),
        },
        now,
      );
      const authUrl = ctx.deps.google.authUrl({
        state,
        codeChallenge: codeChallengeS256(codeVerifier),
        redirectUri: input.redirectUri,
      });
      return { authUrl, state };
    }),

  exchange: publicProcedure
    .input(exchangeInput)
    .output(signInOutput)
    .mutation(async ({ ctx, input }) => {
      const attempt = await ctx.deps.store.takeLoginAttempt(
        input.state,
        ctx.deps.now(),
      );
      if (!attempt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Sign-in expired — try again.",
        });
      }
      let identity: { email: string; emailVerified: boolean };
      try {
        identity = await ctx.deps.google.exchange({
          code: input.code,
          codeVerifier: attempt.codeVerifier,
          redirectUri: attempt.redirectUri,
        });
      } catch (err) {
        console.error(
          "Google exchange failed:",
          err instanceof Error ? err.message : "unknown error",
        );
        throw new TRPCError({
          code: "BAD_GATEWAY",
          message: "Google sign-in failed — try again.",
        });
      }
      const email = identity.email.trim().toLowerCase();
      if (!identity.emailVerified || email !== ctx.deps.config.allowedEmail) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "That Google account isn't allowed to use this hub.",
        });
      }
      return issueSession(ctx.deps, email, input.device);
    }),

  devSignIn: publicProcedure
    .input(z.object({ device: deviceInput }))
    .output(signInOutput)
    .mutation(({ ctx, input }) => {
      if (!ctx.deps.config.devAuth) throw new TRPCError({ code: "NOT_FOUND" });
      return issueSession(ctx.deps, ctx.deps.config.allowedEmail, input.device);
    }),

  me: protectedProcedure.output(meOutput).query(({ ctx }) => ({
    email: ctx.session.email,
    sessionId: ctx.session.id,
  })),

  signOut: protectedProcedure.mutation(async ({ ctx }) => {
    await ctx.deps.store.revokeSession(ctx.session.id, ctx.deps.now());
    return { ok: true as const };
  }),
});
