const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

export function formatLastActive(iso: string, now: Date): string {
  const elapsed = Math.max(0, now.getTime() - new Date(iso).getTime());
  if (elapsed < MINUTE) return "Active now";
  if (elapsed < HOUR)
    return rtf.format(-Math.floor(elapsed / MINUTE), "minute");
  if (elapsed < DAY) return rtf.format(-Math.floor(elapsed / HOUR), "hour");
  return rtf.format(-Math.floor(elapsed / DAY), "day");
}
