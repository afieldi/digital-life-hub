import type { ClaimResult } from "@dlh/module-agent/server";
import type { WorkerApi } from "./api";
import { realTimers, type Timers } from "./run/events";
import {
  type RunHandle,
  type SupervisorDeps,
  startRun,
} from "./run/supervisor";

const CLAIM_EVERY_MS = 30_000;
const SWEEP_EVERY_MS = 60 * 60_000;
/** A run's volume is kept this long after the run ends. */
const VOLUME_KEPT_MS = 7 * 24 * 60 * 60_000;

export type ClaimLoopDeps = Omit<SupervisorDeps, "store" | "log" | "api"> & {
  api: Pick<WorkerApi, "worker" | "asRun" | "onChanges">;
  store: SupervisorDeps["store"] & {
    endedBefore(at: Date): { runId: string; volume: string }[];
    forgetRun(runId: string): void;
  };
  log?: (line: string) => void;
  /** Starts a run's supervisor; tests pass a fake. */
  startRun?: typeof startRun;
};

const firstLine = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).split("\n")[0] ?? "";

/**
 * Drives the worker: removes leftover run containers, claims runs on each
 * `/changes` event and every 30 s (one pass at a time), and hourly removes the
 * volumes of runs that ended more than 7 days ago.
 */
export function createClaimLoop(deps: ClaimLoopDeps) {
  const timers: Timers = deps.timers ?? realTimers;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console.error;
  const start = deps.startRun ?? startRun;
  const { startRun: _s, ...supervisorDeps } = deps;
  void _s;

  const live = new Map<string, RunHandle>();
  const cancels: Array<() => void> = [];
  let stopped = false;
  let passing: Promise<void> | undefined;
  let again = false;

  async function pass() {
    while (!stopped) {
      let claimed: ClaimResult;
      try {
        ({ result: claimed } = await deps.api.worker.agent.claim.mutate({}));
      } catch (e) {
        log(`claim: ${firstLine(e)}`);
        return;
      }
      if (!claimed.run) return;
      try {
        const handle = start(claimed, { ...supervisorDeps, log });
        live.set(handle.runId, handle);
        void handle.done.then(
          () => {
            live.delete(handle.runId);
            trigger();
          },
          () => live.delete(handle.runId),
        );
      } catch (e) {
        log(`start run ${claimed.run.id}: ${firstLine(e)}`);
        return;
      }
    }
  }

  /** Runs a pass now, or one more after the one in flight. */
  function trigger() {
    if (stopped) return;
    if (passing) {
      again = true;
      return;
    }
    passing = (async () => {
      do {
        again = false;
        await pass();
      } while (again && !stopped);
    })().finally(() => {
      passing = undefined;
    });
  }

  async function sweep() {
    for (const { runId, volume } of deps.store.endedBefore(
      new Date(now().getTime() - VOLUME_KEPT_MS),
    )) {
      try {
        await deps.docker.removeVolume(volume);
        deps.store.forgetRun(runId);
      } catch (e) {
        log(`remove volume ${volume}: ${firstLine(e)}`);
      }
    }
  }

  return {
    async start() {
      try {
        for (const name of await deps.docker.listRunContainers()) {
          try {
            await deps.docker.remove(name);
          } catch (e) {
            log(`remove ${name}: ${firstLine(e)}`);
          }
        }
      } catch (e) {
        log(`list run containers: ${firstLine(e)}`);
      }
      cancels.push(deps.api.onChanges(() => trigger()));
      cancels.push(timers.every(CLAIM_EVERY_MS, trigger));
      cancels.push(
        timers.every(SWEEP_EVERY_MS, () => {
          void sweep().catch((e) => log(`sweep: ${firstLine(e)}`));
        }),
      );
      trigger();
      void sweep().catch((e) => log(`sweep: ${firstLine(e)}`));
    },

    /** Stops claiming and stops live runs' containers; their volumes stay. */
    async stop() {
      stopped = true;
      for (const cancel of cancels.splice(0)) cancel();
      await passing;
      const handles = [...live.values()];
      for (const h of handles) h.stop("shutdown");
      await Promise.allSettled(handles.map((h) => h.done));
    },
  };
}
