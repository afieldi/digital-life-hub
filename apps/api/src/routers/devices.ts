import { deviceSession, revokeInput } from "@dlh/api-contract";
import { protectedProcedure, router } from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

export const devicesRouter = router({
  list: protectedProcedure
    .output(z.array(deviceSession))
    .query(async ({ ctx }) => {
      const rows = await ctx.deps.store.listActiveSessions(ctx.deps.now());
      return rows.map((r) => ({
        id: r.id,
        name: r.deviceName,
        platform: r.platform,
        createdAt: r.createdAt.toISOString(),
        lastUsedAt: r.lastUsedAt.toISOString(),
        current: r.id === ctx.session.id,
      }));
    }),

  revoke: protectedProcedure
    .input(revokeInput)
    .mutation(async ({ ctx, input }) => {
      const ok = await ctx.deps.store.revokeSession(input.id, ctx.deps.now());
      if (!ok) throw new TRPCError({ code: "NOT_FOUND" });
      return { ok: true as const };
    }),
});
