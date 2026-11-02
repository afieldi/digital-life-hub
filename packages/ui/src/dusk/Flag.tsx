import { Flag as FlagIcon } from "lucide-react";
import type { ReactNode } from "react";

/** A flagged marker, like a task's "High". */
export function Flag({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex flex-none items-center gap-1 font-ui text-xs font-semibold text-link">
      <FlagIcon aria-hidden="true" size={14} strokeWidth={2.25} />
      {children}
    </span>
  );
}
