import { describe, expect, it } from "vitest";
import { withIdentity } from "../src/identity";
import { settings, stubApi, stubWeb } from "./stubs";

const hub =
  (over: { teamId?: string | null; botUserId?: string | null } = {}) =>
  async () => ({ ...settings, ...over });

describe("withIdentity", () => {
  it("uses auth.test's team and bot ids over the settings", async () => {
    const web = stubWeb({ auth: { team_id: "TREAL", user_id: "UREAL" } });
    const read = withIdentity(hub(), web.web);
    expect(await read()).toEqual({
      ...settings,
      teamId: "TREAL",
      botUserId: "UREAL",
    });
  });

  it("fills them in when the settings hold none, so Slack Connect users are ignored on a default install", async () => {
    const web = stubWeb({ auth: { team_id: "TREAL", user_id: "UREAL" } });
    const read = withIdentity(hub({ teamId: null, botUserId: null }), web.web);
    const merged = await read();
    expect(merged).toMatchObject({ teamId: "TREAL", botUserId: "UREAL" });
  });

  it("keeps the settings when auth.test fails, and remembers the last good answer", async () => {
    const log: string[] = [];
    const bad = stubWeb({ auth: new Error("ratelimited") });
    expect(
      await withIdentity(hub(), bad.web, (l) => log.push(l))(),
    ).toEqual(settings);
    expect(log.some((l) => l.includes("auth.test"))).toBe(true);

    const flaky = stubWeb({ auth: { team_id: "TREAL", user_id: "UREAL" } });
    const read = withIdentity(hub(), flaky.web);
    await read();
    flaky.web.auth.test = () => Promise.reject(new Error("down"));
    expect(await read()).toMatchObject({ teamId: "TREAL", botUserId: "UREAL" });
  });

  it("asks Slack each time the settings are read", async () => {
    const web = stubWeb({ auth: { team_id: "T", user_id: "U" } });
    const read = withIdentity(stubApi().api.botSettings, web.web);
    await read();
    await read();
    expect(web.of("auth.test")).toHaveLength(2);
  });
});
