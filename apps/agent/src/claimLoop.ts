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
/** How long a run claimed again waits for its last supervisor to end. */
const PREVIOUS_END_MS = 60_000;
/** A run's volume is kept this long after the run ends for good. */
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
 * volumes of runs that ended for good (finished, failed, cancelled) more than
 * 7 days ago.
 */
export function createClaimLoop(deps: ClaimLoopDeps) {
  const timers: Timers = deps.timers ?? realTimers;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? console.error;
  const start = deps.startRun ?? startRun;
  const { startRun: _s, ...supervisorDeps } = deps;
  void _s;

  const live = new Map<string, RunHandle>();
  /** Runs whose last supervisor was given up on: their old container goes before they start. */
  const dropped = new Set<string>();
  const cancels: Array<() => void> = [];
  let stopped = false;
  let passing: Promise<void> | undefined;
  let again = false;
  /** The run network was found not isolated, and that was logged. */
  let refused = false;

  /** Runs start only on an isolated network; the first refusal is logged. */
  async function networkReady(): Promise<boolean> {
    const ok = await deps.docker.networkIsolated().catch(() => false);
    if (!ok && !refused) {
      log(
        "the dlh-runs network is missing or not isolated (enable_icc=false, bridge dlh-runs0, no IPv6): claiming no runs until deploy/vps/runs-firewall.sh has made it",
      );
    }
    refused = !ok;
    return ok;
  }

  async function pass() {
    if (!(await networkReady())) return;
    while (!stopped) {
      let claimed: ClaimResult;
      try {
        ({ result: claimed } = await deps.api.worker.agent.claim.mutate({}));
      } catch (e) {
        log(`claim: ${firstLine(e)}`);
        return;
      }
      if (!claimed.run) return;
      // A run answered right after it suspended comes back while its last
      // supervisor still stops the container, whose name the new one takes:
      // start once that one has ended.
      const previous = live.get(claimed.run.id);
      if (previous) {
        let cancel: () => void = () => {};
        const ended = await Promise.race([
          previous.done.then(
            () => true,
            () => true,
          ),
          new Promise<false>((r) => {
            cancel = timers.after(PREVIOUS_END_MS, () => r(false));
          }),
        ]);
        cancel();
        // Stopped meanwhile: the stale sweep requeues the run.
        if (stopped) return;
        if (!ended) {
          // Never ending: forget it. It acts only on its own container and
          // socket, but its container may still hold the run's name. Told to
          // stop, it won't report that container's exit as the run's.
          log(`run ${claimed.run.id}: its last supervisor didn't end`);
          previous.stop("dropped");
          if (live.get(claimed.run.id) === previous) {
            live.delete(claimed.run.id);
          }
          dropped.add(claimed.run.id);
        }
      }
      if (dropped.has(claimed.run.id)) {
        try {
          for (const id of await deps.docker.listRunContainers(
            claimed.run.id,
          )) {
            await deps.docker.remove(id);
          }
          dropped.delete(claimed.run.id);
        } catch (e) {
          // Left claimed: the stale sweep requeues it, and the next claim
          // tries again.
          log(
            `run ${claimed.run.id}: removing its old container: ${firstLine(e)}`,
          );
          continue;
        }
      }
      try {
        const handle = start(claimed, { ...supervisorDeps, log });
        live.set(handle.runId, handle);
        const forget = () => {
          if (live.get(handle.runId) === handle) live.delete(handle.runId);
        };
        void handle.done.then(() => {
          forget();
          trigger();
        }, forget);
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
      } catch (e) {
        // Already gone (removed by hand): forget it all the same.
        if (!/no such volume/i.test(firstLine(e))) {
          log(`remove volume ${volume}: ${firstLine(e)}`);
          continue;
        }
      }
      deps.store.forgetRun(runId);
    }
  }

  return {
    async start() {
      try {
        for (const id of await deps.docker.listRunContainers()) {
          try {
            await deps.docker.remove(id);
          } catch (e) {
            log(`remove ${id}: ${firstLine(e)}`);
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
