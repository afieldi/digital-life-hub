import {
  aiCompleteInput,
  aiLogEntry,
  aiPrepareInput,
  aiProviderId,
  aiResult,
  aiSettings,
} from "@dlh/core";
import { z } from "zod";
import { protectedProcedure, router } from "../trpc";
import { apply, cancel, complete, discard, prepare, undo } from "./gateway";
import { listLog } from "./log";
import { getSettings, providerStatus, setSettings } from "./settings";

const requestId = z.object({ requestId: z.uuid() });
const ok = z.object({ ok: z.literal(true) });
const summary = z.object({ summary: z.string() });

const settings = router({
  get: protectedProcedure
    .output(
      aiSettings.extend({
        providers: z.array(
          z.object({
            id: aiProviderId,
            available: z.boolean(),
            reason: z.literal("no_key").optional(),
          }),
        ),
      }),
    )
    .query(async ({ ctx }) => ({
      ...(await getSettings(ctx.deps.db)),
      providers: providerStatus(ctx.deps),
    })),

  set: protectedProcedure
    .input(aiSettings.partial())
    .output(aiSettings)
    .mutation(({ ctx, input }) =>
      setSettings(ctx.deps.db, input, ctx.deps.now()),
    ),
});

const log = router({
  list: protectedProcedure
    .input(z.object({ cursor: z.string().optional() }))
    .output(
      z.object({
        entries: z.array(aiLogEntry),
        nextCursor: z.string().nullable(),
      }),
    )
    .query(({ ctx, input }) => listLog(ctx.deps.db, input)),
});

export const aiRouter = router({
  prepare: protectedProcedure
    .input(aiPrepareInput)
    .output(aiResult)
    .mutation(({ ctx, input }) => prepare(ctx.deps, input)),

  complete: protectedProcedure
    .input(aiCompleteInput)
    .output(aiResult)
    .mutation(({ ctx, input }) => complete(ctx.deps, input)),

  cancel: protectedProcedure
    .input(requestId)
    .output(ok)
    .mutation(({ ctx, input }) => cancel(ctx.deps, input)),

  // tRPC reserves the name `apply` (it collides with Function.prototype.apply).
  applyOption: protectedProcedure
    .input(requestId.extend({ option: z.number().int().min(0) }))
    .output(summary)
    .mutation(async ({ ctx, input }) => {
      const res = await apply(ctx.deps, input);
      return { summary: res.summary };
    }),

  discard: protectedProcedure
    .input(requestId)
    .output(ok)
    .mutation(({ ctx, input }) => discard(ctx.deps, input)),

  undo: protectedProcedure
    .input(requestId)
    .output(summary)
    .mutation(({ ctx, input }) => undo(ctx.deps, input)),

  settings,
  log,
});
