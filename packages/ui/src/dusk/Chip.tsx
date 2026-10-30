import type { ReactNode } from "react";
import { Link } from "react-aria-components";
import { focusRing } from "../primitives/focus";
import { statusColors } from "../tokens";

type Status = "in_progress" | "review";
const statusLabels: Record<Status, string> = {
  in_progress: "In progress",
  review: "Review",
};

export type ChipProps = {
  kind: "project" | "status" | "type";
  /** Accent colour for project and type chips. */
  color?: string;
  status?: Status;
  href?: string;
  children?: ReactNode;
};

const base =
  "inline-flex min-h-7 items-center gap-1.5 rounded-full border border-white/14 bg-white/8 px-3 font-ui text-xs text-ink-secondary";

export function Chip({ kind, color, status, href, children }: ChipProps) {
  const dot =
    kind === "status" && status
      ? statusColors[status]
      : kind === "project"
        ? color
        : undefined;
  const content = (
    <>
      {dot ? (
        <span
          aria-hidden="true"
          data-testid="chip-dot"
          style={{ backgroundColor: dot }}
          className="size-2 rounded-full"
        />
      ) : null}
      {kind === "status" && status ? statusLabels[status] : children}
    </>
  );
  const style =
    kind === "type" && color
      ? { backgroundColor: color, borderColor: "transparent" }
      : undefined;
  const cls = kind === "type" && color ? `${base} !text-app` : base;
  if (href) {
    return (
      <Link
        href={href}
        style={style}
        // Visual pill stays 28px; the ::before extends the hit area to 44px.
        className={`${cls} relative hover:brightness-125 before:absolute before:inset-x-0 before:-inset-y-2 ${focusRing}`}
      >
        {content}
      </Link>
    );
  }
  return (
    <span style={style} className={cls}>
      {content}
    </span>
  );
}
