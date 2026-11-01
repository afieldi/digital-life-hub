import type { Db } from "@dlh/db";
import { initTRPC, TRPCError } from "@trpc/server";
import { AiError } from "./ai/errors";
import type { AiDeps } from "./ai/gateway";
import type { ChangeBus } from "./changes";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export type CoreDeps = {
  db: Db;
  changes: ChangeBus;
  itemTypes: ReadonlySet<string>;
  now: () => Date;
  devErrors: boolean;
  ai: AiDeps;
};

/** Augmented by apps/api (`declare module "@dlh/server"`) with its own deps. */
// biome-ignore lint/suspicious/noEmptyInterface: extension point for module augmentation
export interface ApiDeps {}

export type Session = { id: string; email: string };

export type Context = { deps: CoreDeps & ApiDeps; session: Session | null };

// isDev is fixed at init, so strip the stack per request from devErrors instead.
// AI failures carry an AiError cause, sent to the app as `data.ai`.
const t = initTRPC.context<Context>().create({
  errorFormatter: ({ shape, ctx, error }) => {
    const ai =
      error.cause instanceof AiError
        ? { code: error.cause.code, message: error.cause.message }
        : undefined;
    const withAi = ai ? { ...shape.data, ai } : shape.data;
    if (ctx?.deps.devErrors) return { ...shape, data: withAi };
    const { stack: _stack, ...data } = withAi;
    return { ...shape, data };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, session: ctx.session } });
});
