import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleBlockAction } from "../src/actions";
import { blocksFor } from "../src/blocks";
import { handleEvent } from "../src/events";
import { settings, stubApi, stubWeb } from "./stubs";

const UNDO = JSON.stringify({
  do: "undo",
  aiRequestId: "0b0f6a2e-5c1d-4c53-8f0e-0d9a5b8f7c11",
});

const deps = (
  web: ReturnType<typeof stubWeb>,
  api: ReturnType<typeof stubApi>,
) => ({
  web: web.web,
  api: api.api,
  settings: async () => settings,
  sleep: async () => {},
});

const click = (user: string, value: string) => ({
  user: { id: user },
  channel: { id: "D1" },
  message: { ts: "200.1", thread_ts: "200.0" },
  actions: [{ action_id: "dlh_0", value }],
});

describe("blocksFor", () => {
  it("is just the text without buttons", () => {
    expect(blocksFor("hi")).toEqual({ text: "hi" });
    expect(blocksFor("hi", [])).toEqual({ text: "hi" });
  });
});

describe("blocksFor limits", () => {
  it("drops a button whose value is over 2000 characters and logs it", () => {
    const log = vi.fn();
    const out = blocksFor(
      "hi",
      [
        { label: "Big", value: "x".repeat(2001) },
        { label: "Ok", value: "y".repeat(2000) },
      ],
      log,
    );
    const block = out.blocks?.[1] as { elements: { value: string }[] };
    const actions = block.elements;
    expect(actions).toHaveLength(1);
    expect(actions[0]?.value).toHaveLength(2000);
    expect(log).toHaveBeenCalledTimes(1);
    expect(
      blocksFor("hi", [{ label: "Big", value: "x".repeat(2001) }], log),
    ).toEqual({ text: "hi" });
  });
});

describe("buttons", () => {
  it("a reply with buttons posts an actions block", async () => {
    const web = stubWeb();
    const api = stubApi([
      { reply: "Done.", buttons: [{ label: "Undo", value: UNDO }] },
    ]);
    await handleEvent(deps(web, api), {
      channel: "D1",
      ts: "100.5",
      user: "UOWNER",
      text: "do it",
      channel_type: "im",
    });
    const args = web.of("chat.postMessage")[0]?.args;
    expect(args?.text).toBe("Done.");
    expect(args?.blocks).toEqual([
      { type: "section", text: { type: "mrkdwn", text: "Done." } },
      {
        type: "actions",
        elements: [
          {
            type: "button",
            text: { type: "plain_text", text: "Undo" },
            action_id: "dlh_0",
            value: UNDO,
          },
        ],
      },
    ]);
  });

  it("a click from you calls handleAction and posts the reply in the thread", async () => {
    const web = stubWeb();
    const api = stubApi(
      [],
      [{ reply: "Undone.", buttons: [{ label: "Redo", value: UNDO }] }],
    );
    await handleBlockAction(deps(web, api), click("UOWNER", UNDO));
    expect(api.of("handleAction")[0]?.input).toEqual(JSON.parse(UNDO));
    const args = web.of("chat.postMessage")[0]?.args;
    expect(args).toMatchObject({
      channel: "D1",
      text: "Undone.",
      thread_ts: "200.0",
    });
    expect(args?.blocks).toHaveLength(2);
  });

  it("a click from someone else does nothing", async () => {
    const web = stubWeb();
    const api = stubApi();
    await handleBlockAction(deps(web, api), click("UDANA", UNDO));
    expect(api.of("handleAction")).toHaveLength(0);
    expect(web.of("chat.postMessage")).toHaveLength(0);
  });

  it("an unreadable button value is ignored", async () => {
    const web = stubWeb();
    const api = stubApi();
    for (const v of ["not json", "[1]", "null", '{"x":1}']) {
      await handleBlockAction(deps(web, api), click("UOWNER", v));
    }
    expect(api.of("handleAction")).toHaveLength(0);
    expect(web.of("chat.postMessage")).toHaveLength(0);
  });
});

describe("an unknown owner", () => {
  it("a click while the owner is unknown does nothing", async () => {
    const web = stubWeb();
    const api = stubApi();
    const log = vi.fn();
    await handleBlockAction(
      {
        ...deps(web, api),
        log,
        settings: async () => {
          throw new TypeError("fetch failed");
        },
      },
      click("UDANA", UNDO),
    );
    expect(web.of("chat.postMessage")).toHaveLength(0);
    expect(api.of("handleAction")).toHaveLength(0);
    expect(log).toHaveBeenCalled();
  });
});

describe("a click with the hub down", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries, then posts that the hub can't be reached", async () => {
    const web = stubWeb();
    const api = stubApi([], [new TypeError("fetch failed")]);
    const { sleep: _sleep, ...rest } = deps(web, api);
    const done = handleBlockAction(rest, click("UOWNER", UNDO));
    await vi.advanceTimersByTimeAsync(20_000);
    await done;
    expect(api.of("handleAction")).toHaveLength(4);
    const posts = web.of("chat.postMessage");
    expect(posts).toHaveLength(1);
    expect(posts[0]?.args).toMatchObject({
      text: "Can't reach the hub right now.",
      thread_ts: "200.0",
    });
  });
});
