import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config";

const env = {
  SLACK_APP_TOKEN: "xapp-1",
  SLACK_BOT_TOKEN: "xoxb-1",
  HUB_API_URL: "http://127.0.0.1:8787",
  HUB_SLACK_TOKEN: "s-token",
};

describe("loadConfig", () => {
  it("reads the five variables", () => {
    expect(loadConfig(env)).toEqual({
      appToken: "xapp-1",
      botToken: "xoxb-1",
      apiUrl: "http://127.0.0.1:8787",
      hubToken: "s-token",
    });
  });

  it("config names every missing variable", () => {
    let message = "";
    try {
      loadConfig({ HUB_API_URL: "not a url", SLACK_BOT_TOKEN: "xoxb-1" });
    } catch (e) {
      message = (e as Error).message;
    }
    for (const name of ["SLACK_APP_TOKEN", "HUB_API_URL", "HUB_SLACK_TOKEN"]) {
      expect(message).toContain(name);
    }
    expect(message).not.toContain("SLACK_BOT_TOKEN");
  });
});
