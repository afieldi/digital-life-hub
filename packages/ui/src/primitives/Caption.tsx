import type { ReactNode } from "react";

/** A line of secondary text, like "Next up at 10:00: …". */
export function Caption({ children }: { children: ReactNode }) {
  return (
    <p className="font-ui text-sm leading-5 text-ink-tertiary">{children}</p>
  );
}
