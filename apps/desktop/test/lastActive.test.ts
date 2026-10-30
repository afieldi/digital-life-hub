import { formatLastActive } from "../src/routes/settings/lastActive";

const now = new Date("2026-10-30T12:00:00Z");
test.each([
  ["2026-10-30T11:59:30Z", "Active now"],
  ["2026-10-30T11:55:00Z", "5 minutes ago"],
  ["2026-10-29T09:00:00Z", "yesterday"],
  ["2026-10-18T12:00:00Z", "12 days ago"],
])("%s → %s", (iso, out) => {
  expect(formatLastActive(iso, now)).toBe(out);
});
