import { initTRPC, TRPCError } from "@trpc/server";
import type { GoogleOAuth } from "./auth/google";
import { authenticate } from "./auth/sessions";
import type { AuthStore, SessionRow } from "./auth/store";
import type { Config } from "./config";

export type AppDeps = {
  config: Config;
  store: AuthStore;
  google: GoogleOAuth;
  now: () => Date;
};

export type Context = { deps: AppDeps; session: SessionRow | null };

export async function createContext(
  deps: AppDeps,
  authorization: string | null | undefined,
): Promise<Context> {
  const match = /^Bearer (.+)$/.exec(authorization ?? "");
  const session = match?.[1]
    ? await authenticate(deps.store, match[1], deps.now())
    : null;
  return { deps, session };
}

// isDev is fixed at init, so strip the stack per request from devAuth instead.
const t = initTRPC.context<Context>().create({
  errorFormatter: ({ shape, ctx }) => {
    if (ctx?.deps.config.devAuth) return shape;
    const { stack: _stack, ...data } = shape.data;
    return { ...shape, data };
  },
});

export const router = t.router;
export const publicProcedure = t.procedure;
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, session: ctx.session } });
});
