import type { ChangeEvent } from "@dlh/api-contract";
import { items } from "@dlh/db";
import { purgeExpired } from "@dlh/server";
import { inArray } from "drizzle-orm";
import type { Handler } from "hono";
import { streamSSE } from "hono/streaming";
import { authenticate, bearerToken } from "./auth/sessions";
import type { AppDeps } from "./trpc";

const DEFAULT_BATCH_MS = 100;
const DEFAULT_HEARTBEAT_MS = 25_000;

/**
 * Server-sent events: one `data: {"ids":[…],"types":[…]}` event (a
 * `ChangeEvent`) per batch of published changes. You listen with a session's
 * token, the agent host's worker with its worker token; a run token is refused.
 * The token is re-checked on every heartbeat, so a revoked device or worker is
 * disconnected within one heartbeat interval.
 */
export function changesHandler(
  deps: AppDeps,
  opts: { batchMs?: number; heartbeatMs?: number } = {},
): Handler {
  const batchMs = opts.batchMs ?? DEFAULT_BATCH_MS;
  const heartbeatMs = opts.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
  return async (c) => {
    const token = bearerToken(c.req.header("Authorization"));
    if (!token || !(await mayListen(deps, token))) {
      return c.json({ error: "UNAUTHORIZED" }, 401);
    }

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
          void typesOf(deps, ids).then((types) => {
            if (closed) return;
            const event: ChangeEvent = types ? { ids, types } : { ids };
            void stream.write(`data: ${JSON.stringify(event)}\n\n`);
          });
        }, batchMs);
      });

      heartbeat = setInterval(async () => {
        try {
          const ok = await mayListen(deps, token);
          if (closed) return;
          if (!ok) close();
          else void stream.write(": ping\n\n");
        } catch (err) {
          // The store failed; end the stream so the client reconnects.
          console.error("changes: token check failed", err);
          close();
        }
      }, heartbeatMs);

      await done;
    });
  };
}

/** A live session's token or a live worker token. */
async function mayListen(deps: AppDeps, token: string): Promise<boolean> {
  if (await authenticate(deps.store, token, deps.now())) return true;
  const principal = await deps.store.findServiceToken(token);
  return principal?.kind === "worker";
}

/** The item types among `ids`; null when the lookup fails (the client then refreshes all). */
async function typesOf(deps: AppDeps, ids: string[]): Promise<string[] | null> {
  try {
    const rows = await deps.db
      .selectDistinct({ type: items.type })
      .from(items)
      .where(inArray(items.id, ids));
    return rows.map((r) => r.type).sort();
  } catch (err) {
    console.error("changes: item types lookup failed", err);
    return null;
  }
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
