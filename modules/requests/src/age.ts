const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** How long ago a request arrived: "now", "5m", "2h", "3d", "2w". Floors; a future time is "now". */
export function ageLabel(at: string | Date, now: Date): string {
  const ms = now.getTime() - new Date(at).getTime();
  if (ms < MINUTE) return "now";
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)}m`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)}h`;
  if (ms < WEEK) return `${Math.floor(ms / DAY)}d`;
  return `${Math.floor(ms / WEEK)}w`;
}
