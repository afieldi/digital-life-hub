import { expect, test } from "vitest";
import { groupFor } from "../src/dates";

test("groupFor at the boundaries", () => {
  const today = "2026-11-04"; // Wednesday; week is Mon Nov 2 - Sun Nov 8
  expect(groupFor(null, today)).toBe("none");
  expect(groupFor("2026-11-03", today)).toBe("overdue");
  expect(groupFor("2026-11-04", today)).toBe("today");
  expect(groupFor("2026-11-05", today)).toBe("week");
  expect(groupFor("2026-11-08", today)).toBe("week");
  expect(groupFor("2026-11-09", today)).toBe("later");
});
