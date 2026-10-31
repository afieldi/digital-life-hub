import { purgeExpired } from "@dlh/server";
import type { Handler } from "hono";
import { streamSSE } from "hono/streaming";
import { authenticate, bearerToken } from "./auth/sessions";
import type { AppDeps } from "./trpc";

const DEFAULT_BATCH_MS = 100;
const DEFAULT_HEARTBEAT_MS = 25_000;

/**
 * Server-sent events: one `data: {"ids":[…]}` event per batch of published
 * changes. The session is re-checked on every heartbeat, so a revoked device
 * is disconnected within one heartbeat interval.
 */
export function changesHandler(
  deps: AppDeps,
  opts: { batchMs?: number; heartbeatMs?: number } = {},
): Handler {
  const batchMs = opts.batchMs ?? DEFAULT_BATCH_MS;
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  return async (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    const session = token
      ? await authenticate(deps.store, token, deps.now())
      : null;
    if (!token || !session) return c.json({ error: "UNAUTHORIZED" }, 401);

    return streamSSE(c, async (stream) => {
      let pending = new Set<string>();
      let batchTimer: ReturnType<typeof setTimeout> | null = null;
      let closed = false;
      let unsubscribe: () => void = () => {};
      let heartbeat: ReturnType<typeof setInterval> | null = null;
      let finish: () => void = () => {};
      const done = new Promise<void>((resolve) => {
        finish = resolve;
      });

      const close = () => {
        if (closed) return;
        closed = true;
        if (batchTimer) clearTimeout(batchTimer);
        if (heartbeat) clearInterval(heartbeat);
        unsubscribe();
        finish();
      };
      stream.onAbort(close);

      unsubscribe = deps.changes.subscribe((ids) => {
        for (const id of ids) pending.add(id);
        if (batchTimer) return;
        batchTimer = setTimeout(() => {
          batchTimer = null;
          const ids = [...pending];
          pending = new Set();
          if (closed || ids.length === 0) return;
          void stream.write(`data: ${JSON.stringify({ ids })}\n\n`);
        }, batchMs);
      });

      heartbeat = setInterval(async () => {
        try {
          const row = await authenticate(deps.store, token, deps.now());
          if (closed) return;
          if (!row) close();
          else void stream.write(": ping\n\n");
        } catch {
          // The store failed; end the stream so the client reconnects.
          close();
        }
      }, heartbeatMs);

      await done;
    });
  };
}

/** Runs the purge now, then on an interval. Failures are logged, never thrown. */
export function startPurgeJob(deps: AppDeps, everyMs = 86_400_000): () => void {
  const run = () => {
    purgeExpired(deps).catch((err) => {
      console.error("purge failed", err);
    });
  };
  run();
  const timer = setInterval(run, everyMs);
  timer.unref();
  return () => clearInterval(timer);
}
