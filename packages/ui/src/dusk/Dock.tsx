import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-aria-components";
import { GlassPanel } from "../glass/GlassPanel";
import { focusRing } from "../primitives/focus";

export type DockItem = {
  id: string;
  label: string;
  icon: LucideIcon;
  href: string;
};

export function Dock({
  items,
  currentHref,
  trailing,
  className,
}: {
  items: DockItem[];
  currentHref: string;
  trailing?: ReactNode;
  /** Positioning override, e.g. "absolute" to contain the dock in a story. */
  className?: string;
}) {
  return (
    <GlassPanel
      level="nav"
      as="nav"
      aria-label="Primary"
      className={`${className ?? "fixed"} bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 p-1.5 font-ui`}
    >
      {items.map(({ id, label, icon: Icon, href }) => {
        const current = href === currentHref;
        return (
          <Link
            key={id}
            href={href}
            aria-current={current ? "page" : undefined}
            className={`flex min-h-11 min-w-16 flex-col items-center gap-0.5 rounded-14 px-1.5 py-2 text-[11px] hover:bg-white/8 pressed:bg-white/14 ${
              current ? "bg-white/16 text-ink-primary" : "text-ink-tertiary"
            } ${focusRing}`}
          >
            <Icon aria-hidden="true" size={20} />
            <span>{label}</span>
          </Link>
        );
      })}
      {trailing ? (
        <>
          <span aria-hidden="true" className="mx-1 h-8 w-px bg-white/14" />
          {trailing}
        </>
      ) : null}
    </GlassPanel>
  );
}
