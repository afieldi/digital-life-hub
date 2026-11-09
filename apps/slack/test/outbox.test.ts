import { describe, expect, it } from "vitest";
import type { HubApi, PendingSend } from "../src/api";
import { createOutbox } from "../src/outbox";
import { stubApi, stubWeb } from "./stubs";

const row = (id: string, over: Partial<PendingSend> = {}): PendingSend => ({
  id,
  channelId: "D1",
  threadTs: "100.0",
  text: `text ${id}`,
  ...over,
});

/** A hub whose approved rows leave the queue once marked, as in the real one. */
function hub(rows: PendingSend[]) {
  const base = stubApi();
  const queue = [...rows];
  const calls: string[] = [];
  const api: HubApi = {
    ...base.api,
    syncRuns: async () => {
      calls.push("syncRuns");
    },
    pendingSends: async () => {
      calls.push("pendingSends");
      return [...queue];
    },
    markSent: async (i) => {
      calls.push(`sent:${i.id}:${i.ts}`);
      queue.splice(
        queue.findIndex((r) => r.id === i.id),
        1,
      );
    },
    markFailed: async (i) => {
      calls.push(`failed:${i.id}:${i.error}`);
      queue.splice(
        queue.findIndex((r) => r.id === i.id),
        1,
      );
    },
  };
  return { api, calls };
}

function bot(fail: Record<string, string> = {}) {
  const { web, calls } = stubWeb();
  let n = 0;
  web.chat.postMessage = async (a) => {
    calls.push({ method: "chat.postMessage", args: a });
    const code = fail[a.text];
    if (code) throw Object.assign(new Error(code), { data: { error: code } });
    return { ts: `9${++n}.0` };
  };
  return {
    web,
    posts: () => calls.filter((c) => c.method === "chat.postMessage"),
  };
}

describe("outbox tick", () => {
  it("a report is posted as the bot in its thread", async () => {
    const h = hub([row("a"), row("b", { threadTs: null })]);
    const b = bot();
    await createOutbox({ api: h.api, bot: b.web }).tick();
    expect(b.posts().map((p) => p.args)).toEqual([
      { channel: "D1", text: "text a", thread_ts: "100.0" },
      { channel: "D1", text: "text b", thread_ts: undefined },
    ]);
    expect(h.calls).toEqual([
      "syncRuns",
      "pendingSends",
      "sent:a:91.0",
      "sent:b:92.0",
    ]);
  });

  it("a restart sends what was approved, once", async () => {
    const h = hub([row("a"), row("b"), row("c")]);
    const b = bot();
    const first = createOutbox({ api: h.api, bot: b.web });
    await first.tick();
    // A restarted service: a new loop over the same hub.
    await createOutbox({ api: h.api, bot: b.web }).tick();
    await first.tick();
    expect(b.posts().map((p) => p.args.text)).toEqual([
      "text a",
      "text b",
      "text c",
    ]);
  });

  it("a Slack error marks the row failed with its code, and the rest go on", async () => {
    const h = hub([row("a"), row("b")]);
    const b = bot({ "text a": "channel_not_found" });
    await createOutbox({ api: h.api, bot: b.web }).tick();
    expect(h.calls).toContain("failed:a:channel_not_found");
    expect(h.calls).toContain("sent:b:91.0");
  });

  it("a hub failure is logged and the next tick retries", async () => {
    const h = hub([row("a")]);
    let fail = true;
    const sync = h.api.syncRuns;
    h.api.syncRuns = async () => {
      if (fail) throw new Error("hub down");
      return sync();
    };
    const b = bot();
    const log: string[] = [];
    const outbox = createOutbox({
      api: h.api,
      bot: b.web,
      log: (l) => log.push(l),
    });
    await outbox.tick();
    expect(log.join()).toContain("hub down");
    expect(b.posts()).toHaveLength(0);
    fail = false;
    await outbox.tick();
    expect(b.posts()).toHaveLength(1);
  });

  it("a markSent that fails is repeated, not the post", async () => {
    const h = hub([row("a")]);
    const mark = h.api.markSent;
    let n = 0;
    h.api.markSent = async (i) => {
      if (n++ === 0) throw new Error("hub down");
      return mark(i);
    };
    const b = bot();
    await createOutbox({
      api: h.api,
      bot: b.web,
      sleep: async () => {},
    }).tick();
    expect(b.posts()).toHaveLength(1);
    expect(h.calls).toContain("sent:a:91.0");
  });

  it("a rate limit leaves the row for the next tick", async () => {
    const h = hub([row("a"), row("b")]);
    const b = bot({ "text a": "ratelimited" });
    const log: string[] = [];
    await createOutbox({
      api: h.api,
      bot: b.web,
      log: (l) => log.push(l),
    }).tick();
    expect(h.calls.filter((c) => /^(sent|failed)/.test(c))).toEqual([]);
    expect(b.posts()).toHaveLength(1);
    expect(log.join()).toContain("retrying next tick");
  });

  it("a network error leaves the row for the next tick", async () => {
    const h = hub([row("a"), row("b")]);
    const { web, posts } = bot();
    let down = true;
    const post = web.chat.postMessage;
    web.chat.postMessage = async (a) => {
      if (down) throw new Error("socket hang up");
      return post(a);
    };
    const outbox = createOutbox({ api: h.api, bot: web });
    await outbox.tick();
    expect(h.calls.filter((c) => /^(sent|failed)/.test(c))).toEqual([]);
    down = false;
    await outbox.tick();
    expect(posts().map((p) => p.args.text)).toEqual(["text a", "text b"]);
    expect(h.calls).toContain("sent:a:91.0");
  });

  it("an unrecordable mark stops the batch", async () => {
    const h = hub([row("a"), row("b")]);
    h.api.markSent = async () => {
      throw new Error("hub down");
    };
    const b = bot();
    await createOutbox({
      api: h.api,
      bot: b.web,
      sleep: async () => {},
    }).tick();
    expect(b.posts().map((p) => p.args.text)).toEqual(["text a"]);
  });

  it("a post without a timestamp is marked failed", async () => {
    const h = hub([row("a")]);
    const { web } = bot();
    web.chat.postMessage = async () => ({});
    await createOutbox({ api: h.api, bot: web }).tick();
    expect(h.calls).toContain("failed:a:Slack gave no timestamp");
  });

  it("ticks never overlap", async () => {
    const h = hub([]);
    let running = 0;
    let max = 0;
    let ticks = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    h.api.syncRuns = async () => {
      running++;
      ticks++;
      max = Math.max(max, running);
      if (ticks === 1) await gate;
      running--;
    };
    const outbox = createOutbox({ api: h.api, bot: bot().web });
    const all = [outbox.tick(), outbox.tick(), outbox.tick()];
    release();
    await Promise.all(all);
    expect(max).toBe(1);
    // The two requests made while one ran become one follow-up.
    expect(ticks).toBe(2);
  });
});
