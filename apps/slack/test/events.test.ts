import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HubError } from "../src/api";
import { fetchContext } from "../src/context";
import { handleEvent, serialByUser } from "../src/events";
import { githubLogin } from "../src/profile";
import { firstSent, settings, stubApi, stubWeb } from "./stubs";

const dm = {
  channel: "D1",
  ts: "100.5",
  user: "UDANA",
  text: "please look at the login bug",
  channel_type: "im",
};

const deps = (
  web: ReturnType<typeof stubWeb>,
  api: ReturnType<typeof stubApi>,
) => ({
  web: web.web,
  api: api.api,
  settings: async () => settings,
});

describe("fetchContext", () => {
  const msgs = Array.from({ length: 15 }, (_, i) => ({
    ts: `${i + 1}.0`,
    user: i % 3 === 0 ? "UBOT" : i % 3 === 1 ? "UOWNER" : "UDANA",
    text: `m${i + 1}`,
  }));

  it("context comes from replies in a thread and history in a DM, 10 at most", async () => {
    const dmWeb = stubWeb({ history: [...msgs].reverse() });
    const fromDm = await fetchContext(dmWeb.web, dm, settings);
    expect(dmWeb.of("history")).toHaveLength(1);
    expect(dmWeb.of("replies")).toHaveLength(0);
    expect(fromDm).toHaveLength(10);
    expect(fromDm.map((t) => t.text)).toEqual(msgs.slice(5).map((m) => m.text));
    expect(fromDm[0]).toEqual({ from: "sender", text: "m6" });
    expect(fromDm[1]).toEqual({ from: "bot", text: "m7" });
    expect(fromDm[2]).toEqual({ from: "owner", text: "m8" });

    const threadWeb = stubWeb({
      replies: [...msgs, { ts: dm.ts, user: "UDANA", text: "current" }],
    });
    const fromThread = await fetchContext(
      threadWeb.web,
      { ...dm, thread_ts: "1.0" },
      settings,
    );
    expect(threadWeb.of("replies")[0]?.args).toMatchObject({
      channel: "D1",
      ts: "1.0",
    });
    expect(threadWeb.of("history")).toHaveLength(0);
    expect(fromThread).toHaveLength(10);
    expect(fromThread.at(-1)?.text).toBe("m15");
  });
});

describe("githubLogin", () => {
  it("finds the GitHub field by label in a login, @login or URL", () => {
    expect(githubLogin({ A: { label: " github ", value: "@dana" } })).toBe(
      "dana",
    );
    expect(githubLogin({ A: { label: "GitHub", value: "dana" } })).toBe("dana");
    expect(
      githubLogin({
        A: { label: "GitHub", value: "https://github.com/dana/" },
      }),
    ).toBe("dana");
    expect(githubLogin({ A: { label: "Team", value: "x" } })).toBeNull();
    expect(githubLogin(undefined)).toBeNull();
  });
});

describe("handleEvent", () => {
  it("a coworker DM is sent to handleMessage and the reply posted in place", async () => {
    const web = stubWeb({
      history: [{ ts: "99.0", user: "UBOT", text: "hello" }],
    });
    const api = stubApi([{ reply: "Filed it." }]);
    await handleEvent(deps(web, api), dm);

    expect(api.of("handleMessage")).toHaveLength(1);
    expect(api.of("handleMessage")[0]?.input).toEqual({
      event: {
        channel: "D1",
        ts: "100.5",
        text: "please look at the login bug",
        permalink: "https://x.slack.com/archives/D1/p100.5",
        isDm: true,
      },
      sender: {
        slackUserId: "UDANA",
        name: "Dana Coworker",
        githubLogin: "dana",
        isOwner: false,
      },
      context: [{ from: "bot", text: "hello" }],
    });
    expect(api.of("upsertPerson")[0]?.input).toEqual({
      slackUserId: "UDANA",
      name: "Dana Coworker",
      githubLogin: "dana",
    });
    // A top-level DM stays top level.
    expect(web.of("chat.postMessage")).toEqual([
      {
        method: "chat.postMessage",
        args: { channel: "D1", text: "Filed it.", thread_ts: undefined },
      },
    ]);
  });

  it("replies in the thread when the message is in one", async () => {
    const web = stubWeb();
    const api = stubApi([{ reply: "ok" }]);
    await handleEvent(deps(web, api), { ...dm, thread_ts: "90.0" });
    expect(web.of("chat.postMessage")[0]?.args.thread_ts).toBe("90.0");
    expect(firstSent(api).event.threadTs).toBe("90.0");
  });

  it("an app mention in a channel is answered under the message", async () => {
    const web = stubWeb();
    const api = stubApi([{ reply: "ok" }]);
    await handleEvent(deps(web, api), {
      channel: "C1",
      ts: "5.5",
      user: "UDANA",
      text: "<@UBOT> hi",
    });
    expect(web.of("chat.postMessage")[0]?.args.thread_ts).toBe("5.5");
    expect(firstSent(api).event.isDm).toBe(false);
  });

  it("a react result adds eyes", async () => {
    const web = stubWeb();
    const api = stubApi([{ react: "eyes" }]);
    await handleEvent(deps(web, api), dm);
    expect(web.of("reactions.add")[0]?.args).toEqual({
      channel: "D1",
      timestamp: "100.5",
      name: "eyes",
    });
    expect(web.of("chat.postMessage")).toHaveLength(0);
  });

  it("ignored events reach nothing", async () => {
    const web = stubWeb();
    const api = stubApi();
    await handleEvent(deps(web, api), { ...dm, bot_id: "B1" });
    expect(api.calls).toHaveLength(0);
    expect(web.calls).toHaveLength(0);
  });

  it("reads the profile once per person per process", async () => {
    const web = stubWeb();
    const api = stubApi([{ react: "eyes" }]);
    const d = deps(web, api);
    await handleEvent(d, dm);
    await handleEvent(d, { ...dm, ts: "101.0" });
    expect(web.of("users.profile.get")).toHaveLength(1);
    expect(api.of("upsertPerson")).toHaveLength(1);
    expect(api.of("handleMessage")).toHaveLength(2);
  });

  it("a profile without a GitHub field gives a null login", async () => {
    const web = stubWeb({ fields: {} });
    const api = stubApi([{ react: "eyes" }]);
    await handleEvent(deps(web, api), dm);
    expect(firstSent(api).sender.githubLogin).toBeNull();
  });

  it("a refused call is not retried and the sender is told", async () => {
    const web = stubWeb();
    const api = stubApi([new HubError("BAD_REQUEST", "no")]);
    await handleEvent(deps(web, api), dm);
    expect(api.of("handleMessage")).toHaveLength(1);
    expect(web.of("chat.postMessage")[0]?.args.text).toBe(
      "Couldn't pass this on, please try again later.",
    );
  });
});

describe("hub down", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("API down: retries then apologises, no ack", async () => {
    const web = stubWeb();
    const api = stubApi([
      new TypeError("fetch failed"),
      new HubError("INTERNAL_SERVER_ERROR", "boom"),
      new TypeError("fetch failed"),
      new TypeError("fetch failed"),
    ]);
    const start = Date.now();
    const done = handleEvent(deps(web, api), dm);
    await vi.advanceTimersByTimeAsync(20_000);
    await done;

    expect(api.of("handleMessage").map((c) => c.at - start)).toEqual([
      0, 1000, 5000, 20000,
    ]);
    const posts = web.of("chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.args.text).toBe(
      "Couldn't pass this on, please try again later.",
    );
    expect(web.of("reactions.add")).toHaveLength(0);
  });

  it("the owner is told the hub can't be reached", async () => {
    const web = stubWeb();
    const api = stubApi([new TypeError("fetch failed")]);
    const done = handleEvent(deps(web, api), { ...dm, user: "UOWNER" });
    await vi.advanceTimersByTimeAsync(20_000);
    await done;
    expect(web.of("chat.postMessage")[0]?.args.text).toBe(
      "Can't reach the hub right now.",
    );
  });

  it("a retry that succeeds answers as normal", async () => {
    const web = stubWeb();
    const api = stubApi([new TypeError("fetch failed"), { reply: "Filed." }]);
    const done = handleEvent(deps(web, api), dm);
    await vi.advanceTimersByTimeAsync(1000);
    await done;
    expect(web.of("chat.postMessage")[0]?.args.text).toBe("Filed.");
  });
});

describe("serialByUser", () => {
  it("two quick messages from one sender are handled one after the other", async () => {
    const web = stubWeb();
    const api = stubApi([{ react: "eyes" }]);
    let active = 0;
    let overlap = 0;
    const real = api.api.handleMessage;
    api.api.handleMessage = async (input) => {
      active++;
      overlap = Math.max(overlap, active);
      await new Promise((r) => setTimeout(r, 20));
      try {
        return await real(input);
      } finally {
        active--;
      }
    };
    const handle = serialByUser(deps(web, api));
    await Promise.all([
      handle(dm),
      handle({ ...dm, ts: "101.0" }),
      handle({ ...dm, ts: "102.0" }),
    ]);
    expect(overlap).toBe(1);
    expect(
      api
        .of("handleMessage")
        .map((c) => (c.input as { event: { ts: string } }).event.ts),
    ).toEqual(["100.5", "101.0", "102.0"]);
  });

  it("different senders run at the same time", async () => {
    const web = stubWeb();
    const api = stubApi([{ react: "eyes" }]);
    let active = 0;
    let overlap = 0;
    api.api.handleMessage = async () => {
      active++;
      overlap = Math.max(overlap, active);
      await new Promise((r) => setTimeout(r, 20));
      active--;
      return { react: "eyes" };
    };
    const handle = serialByUser(deps(web, api));
    await Promise.all([handle(dm), handle({ ...dm, user: "UOTHER" })]);
    expect(overlap).toBe(2);
  });
});
