import type { ReactNode } from "react";
import { Link } from "react-aria-components";
import { focusRing } from "../primitives/focus";

export type ItemRowProps = {
  leading?: ReactNode;
  title: string;
  meta?: ReactNode;
  chips?: ReactNode;
  trailing?: ReactNode;
  /** Makes the title a link; its hit area stretches over the whole row. */
  href?: string;
  /** Strikes the title in ink-muted (#D9CFD6). */
  done?: boolean;
};

// Inline style (not a class) so the done state is a computed style in tests too.
const doneStyle = {
  textDecorationLine: "line-through",
  color: "var(--color-ink-muted)",
} as const;

export function ItemRow({
  leading,
  title,
  meta,
  chips,
  trailing,
  href,
  done,
}: ItemRowProps) {
  const titleClass = "truncate text-[15px] font-medium text-ink-primary";
  return (
    <div
      data-done={done || undefined}
      className="relative flex min-h-[52px] items-center gap-3 rounded-14 px-3 py-2 font-ui hover:bg-white/6"
    >
      {leading ? (
        <div className="relative z-10 flex shrink-0 items-center">
          {leading}
        </div>
      ) : null}
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {href ? (
          <Link
            href={href}
            style={done ? doneStyle : undefined}
            // ::after stretches the link over the row; leading/chips/trailing sit above it.
            className={`${titleClass} rounded-10 after:absolute after:inset-0 after:content-[''] ${focusRing}`}
          >
            {title}
          </Link>
        ) : (
          <span style={done ? doneStyle : undefined} className={titleClass}>
            {title}
          </span>
        )}
        {meta || chips ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-tertiary">
            {meta ? <span>{meta}</span> : null}
            {chips ? (
              <span className="relative z-10 flex flex-wrap items-center gap-1.5">
                {chips}
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      {trailing ? (
        <div className="relative z-10 flex shrink-0 items-center gap-2 text-xs text-ink-tertiary">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}
