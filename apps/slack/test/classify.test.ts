import { describe, expect, it } from "vitest";
import { classify } from "../src/classify";
import { settings } from "./stubs";

const base = { channel: "D1", ts: "1.1", user: "UDANA", text: "hi" };

describe("classify", () => {
  it("ignores bots, its own posts, subtypes and other teams", () => {
    expect(classify({ ...base, bot_id: "B1" }, settings)).toBe("ignore");
    expect(classify({ ...base, user: "UBOT" }, settings)).toBe("ignore");
    expect(classify({ ...base, subtype: "message_changed" }, settings)).toBe(
      "ignore",
    );
    expect(classify({ ...base, subtype: "message_deleted" }, settings)).toBe(
      "ignore",
    );
    expect(classify({ ...base, user_team: "T2" }, settings)).toBe("ignore");
    expect(classify({ ...base, team: "T2" }, settings)).toBe("ignore");
    expect(classify({ ...base, user: undefined }, settings)).toBe("ignore");
  });

  it("marks the owner and coworkers", () => {
    expect(classify({ ...base, user: "UOWNER" }, settings)).toBe("owner");
    expect(classify({ ...base, team: "T1", user_team: "T1" }, settings)).toBe(
      "coworker",
    );
    expect(classify(base, settings)).toBe("coworker");
  });
});
