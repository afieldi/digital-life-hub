import { describe, expect, it, vi } from "vitest";
import { createClaimLoop } from "../src/claimLoop";
import type { Docker } from "../src/docker/docker";
import type { Claimed, RunHandle, Timers } from "../src/run/supervisor";

const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-11-05T10:00:00.000Z");

/** Timers fired by hand, by period. */
function fakeTimers() {
  const every = new Map<number, () => void>();
  const after = new Map<number, () => void>();
  const timers: Timers = {
    every(ms, fn) {
      every.set(ms, fn);
      return () => every.delete(ms);
    },
    after(ms, fn) {
      after.set(ms, fn);
      return () => after.delete(ms);
    },
  };
  return { timers, every, after };
}

const claim = (id: string) =>
  ({ run: { id }, token: "tok" }) as unknown as Claimed;

function setup(opts: {
  claims?: Array<() => Promise<unknown>>;
  ended?: { runId: string; volume: string }[];
  containers?: string[];
  removeVolume?: (name: string) => Promise<void>;
  isolated?: () => boolean;
}) {
  const { timers, every, after } = fakeTimers();
  let onChange: () => void = () => {};
  const unsubscribe = vi.fn();
  const queue = [...(opts.claims ?? [])];
  const claimFn = vi.fn(async () => {
    const next = queue.shift();
    return { result: next ? await next() : { run: null }, undo: null };
  });
  const docker = {
    listRunContainers: vi.fn(async () => opts.containers ?? []),
    remove: vi.fn(async () => {}),
    removeVolume: vi.fn(opts.removeVolume ?? (async () => {})),
    networkIsolated: vi.fn(async () => opts.isolated?.() ?? true),
  } as unknown as Docker;
  const store = {
    secretOf: vi.fn(),
    markStarted: vi.fn(),
    markEnded: vi.fn(),
    endedBefore: vi.fn(() => opts.ended ?? []),
    forgetRun: vi.fn(),
  };
  const handles: Array<RunHandle & { end(): void }> = [];
  const started: string[] = [];
  const startRun = vi.fn((c: Claimed) => {
    started.push(c.run.id);
    let end!: () => void;
    const done = new Promise<{ runId: string; reason: string }>((r) => {
      end = () => r({ runId: c.run.id, reason: "finished" });
    });
    const h = {
      runId: c.run.id,
      done,
      stop: vi.fn((reason: string) => {
        void reason;
        end();
      }),
      end,
    };
    handles.push(h);
    return h;
  });
  const logs: string[] = [];
  const loop = createClaimLoop({
    api: {
      worker: { agent: { claim: { mutate: claimFn } } },
      asRun: () => ({ call: async () => null }),
      onChanges: (cb: () => void) => {
        onChange = cb;
        return unsubscribe;
      },
    } as never,
    docker,
    store,
    dataDir: "/data",
    image: "img",
    relay: {} as never,
    timers,
    now: () => NOW,
    log: (l) => logs.push(l),
    startRun: startRun as never,
  });
  const idle = () => new Promise((r) => setTimeout(r, 0));
  return {
    loop,
    claimFn,
    docker,
    store,
    started,
    handles,
    logs,
    every,
    after,
    unsubscribe,
    startRun,
    change: () => onChange(),
    idle,
  };
}

describe("claim loop", () => {
  it("start removes leftover run containers", async () => {
    const s = setup({ containers: ["dlh-run-a", "dlh-run-b"] });
    await s.loop.start();
    expect(s.docker.remove).toHaveBeenCalledWith("dlh-run-a");
    expect(s.docker.remove).toHaveBeenCalledWith("dlh-run-b");
    await s.loop.stop();
  });

  it("a changes event claims until none is left", async () => {
    const s = setup({
      claims: [async () => claim("r1"), async () => claim("r2")],
    });
    await s.loop.start();
    await s.idle();
    // The first pass at start took both and stopped at null.
    expect(s.started).toEqual(["r1", "r2"]);
    expect(s.claimFn).toHaveBeenCalledTimes(3);
    s.change();
    await s.idle();
    expect(s.claimFn).toHaveBeenCalledTimes(4);
    await s.loop.stop();
  });

  it("claims on the 30 s timer", async () => {
    const s = setup({});
    await s.loop.start();
    await s.idle();
    const before = s.claimFn.mock.calls.length;
    s.every.get(30_000)?.();
    await s.idle();
    expect(s.claimFn.mock.calls.length).toBe(before + 1);
    await s.loop.stop();
  });

  it("claims don't overlap", async () => {
    let release!: () => void;
    let running = 0;
    let peak = 0;
    const slow = () =>
      new Promise<unknown>((resolve) => {
        running++;
        peak = Math.max(peak, running);
        release = () => {
          running--;
          resolve({ run: null });
        };
      });
    const s = setup({ claims: [slow, slow] });
    await s.loop.start();
    await s.idle();
    s.change();
    s.change();
    s.every.get(30_000)?.();
    await s.idle();
    expect(s.claimFn).toHaveBeenCalledTimes(1);
    release();
    await s.idle();
    // Events during the pass schedule one more pass, not one each.
    expect(s.claimFn).toHaveBeenCalledTimes(2);
    release();
    await s.idle();
    expect(s.claimFn).toHaveBeenCalledTimes(2);
    expect(peak).toBe(1);
    await s.loop.stop();
  });

  it("a claim error doesn't stop the loop", async () => {
    const s = setup({
      claims: [
        async () => {
          throw new Error("boom\nsecond line with Bearer abc");
        },
      ],
    });
    await s.loop.start();
    await s.idle();
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0]).toContain("boom");
    expect(s.logs[0]).not.toContain("second line");
    s.change();
    await s.idle();
    expect(s.claimFn).toHaveBeenCalledTimes(2);
    await s.loop.stop();
  });

  it("a run claimed again starts once its last container has ended", async () => {
    // Suspended, then answered at once: the claim comes while the first
    // supervisor is still stopping its container, whose name the next takes.
    const s = setup({
      claims: [
        async () => claim("r1"),
        async () => ({ run: null }),
        async () => claim("r1"),
      ],
    });
    await s.loop.start();
    await s.idle();
    expect(s.started).toEqual(["r1"]);
    s.change();
    await s.idle();
    expect(s.started).toEqual(["r1"]);
    s.handles[0]?.end();
    await s.idle();
    await s.idle();
    expect(s.started).toEqual(["r1", "r1"]);
    // The first one's end didn't drop the second from the live runs.
    await s.loop.stop();
    expect(s.handles[1]?.stop).toHaveBeenCalledWith("shutdown");
  });

  it("a last supervisor that never ends doesn't stop the claims", async () => {
    const s = setup({
      claims: [
        async () => claim("r1"),
        async () => ({ run: null }),
        async () => claim("r1"),
        async () => claim("r2"),
        async () => ({ run: null }),
        async () => claim("r1"),
      ],
    });
    await s.loop.start();
    await s.idle();
    s.change();
    await s.idle();
    // r1's first supervisor hangs: after a minute the pass gives up on it.
    expect(s.started).toEqual(["r1"]);
    s.after.get(60_000)?.();
    await s.idle();
    await s.idle();
    expect(s.logs.some((l) => l.includes("r1"))).toBe(true);
    // The claim goes on to other runs, and r1 claimed again starts.
    expect(s.started).toEqual(["r1", "r2"]);
    s.change();
    await s.idle();
    expect(s.started).toEqual(["r1", "r2", "r1"]);
    s.handles[0]?.end();
    await s.loop.stop();
  });

  it("no run is claimed while the run network isn't isolated", async () => {
    let isolated = false;
    const s = setup({
      claims: [async () => claim("r1")],
      isolated: () => isolated,
    });
    await s.loop.start();
    await s.idle();
    s.change();
    await s.idle();
    expect(s.claimFn).not.toHaveBeenCalled();
    // Said once, not on every pass.
    expect(s.logs.filter((l) => l.includes("dlh-runs"))).toHaveLength(1);
    isolated = true;
    s.change();
    await s.idle();
    expect(s.started).toEqual(["r1"]);
    await s.loop.stop();
  });

  it("old volumes are removed and forgotten", async () => {
    const s = setup({
      ended: [
        { runId: "a", volume: "dlh-ws-a" },
        { runId: "b", volume: "dlh-ws-b" },
        { runId: "c", volume: "dlh-ws-c" },
      ],
      removeVolume: async (name) => {
        if (name === "dlh-ws-b") throw new Error("in use\nmore");
        if (name === "dlh-ws-c") {
          throw new Error(
            "Error response from daemon: get dlh-ws-c: no such volume",
          );
        }
      },
    });
    await s.loop.start();
    await s.idle();
    expect(s.store.endedBefore).toHaveBeenCalledWith(
      new Date(NOW.getTime() - 7 * DAY),
    );
    expect(s.store.forgetRun).toHaveBeenCalledWith("a");
    expect(s.store.forgetRun).toHaveBeenCalledWith("c");
    expect(s.store.forgetRun).not.toHaveBeenCalledWith("b");
    expect(s.logs.some((l) => l.includes("in use"))).toBe(true);
    expect(s.logs.some((l) => l.includes("more"))).toBe(false);
    s.every.get(60 * 60_000)?.();
    await s.idle();
    expect(s.store.endedBefore).toHaveBeenCalledTimes(2);
    await s.loop.stop();
  });

  it("stop stops live runs and keeps their volumes", async () => {
    const s = setup({ claims: [async () => claim("r1")] });
    await s.loop.start();
    await s.idle();
    await s.loop.stop();
    expect(s.handles[0]?.stop).toHaveBeenCalledWith("shutdown");
    expect(s.docker.removeVolume).not.toHaveBeenCalled();
    expect(s.unsubscribe).toHaveBeenCalled();
    expect(s.every.size).toBe(0);
    s.change();
    await s.idle();
    expect(s.claimFn).toHaveBeenCalledTimes(2);
  });
});
