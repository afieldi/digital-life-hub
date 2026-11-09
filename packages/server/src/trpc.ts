import type { Db } from "@dlh/db";
import { initTRPC, TRPCError } from "@trpc/server";
import { AiError } from "./ai/errors";
import type { AiDeps } from "./ai/gateway";
import type { ChangeBus } from "./changes";
import type { ImplementedOperation } from "./operations/implement";

export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * A module's hook: the ids to delete (or, when `restoring`, restore) together with
 * item `id`. Core applies them in the same transaction, so the module needs no
 * `expectedUpdatedAt` for them.
 */
export type DeleteWith = (
  tx: Tx,
  id: string,
  opts: { restoring: boolean },
) => Promise<string[]>;

/**
 * A module's check on every call an agent run makes, after access and run
 * identity and before the operation runs. It refuses by throwing (a
 * TRPCError). Operations a call reaches with `w.call` are not checked again.
 */
export type RunGuard = (
  deps: CoreDeps,
  call: { runId: string; operation: ImplementedOperation; input: unknown },
) => Promise<void>;

export type CoreDeps = {
  db: Db;
  changes: ChangeBus;
  itemTypes: ReadonlySet<string>;
  now: () => Date;
  devErrors: boolean;
  ai: AiDeps;
  /** Item type -> hook of the module that owns it. */
  deleteWith: ReadonlyMap<string, DeleteWith>;
  /** Operation id -> module operation, for `ops.undo`. */
  operations: ReadonlyMap<string, ImplementedOperation>;
  /** Module id -> its checked config (`configFor`), for modules that declare one. */
  moduleConfig: ReadonlyMap<string, unknown>;
  /** Each module's `runGuard`, in module order, for every run's call. */
  runGuards: readonly RunGuard[];
};

/** Augmented by apps/api (`declare module "@dlh/server"`) with its own deps. */
// biome-ignore lint/suspicious/noEmptyInterface: extension point for module augmentation
export interface ApiDeps {}

export type Session = { id: string; email: string };

/**
 * Who a request comes from: you (a session), the agent host's worker, the
 * Slack bot, or one agent run, each by its bearer token.
 */
export type Principal =
  | { kind: "user"; session: Session }
  | { kind: "worker"; tokenId: string }
  | { kind: "slack"; tokenId: string }
  | { kind: "run"; tokenId: string; runId: string };

/** `session` is set only for you; `principal` for any signed-in caller. */
export type Context = {
  deps: CoreDeps & ApiDeps;
  session: Session | null;
  principal: Principal | null;
};

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
