import { Link } from "react-aria-components";
import { focusRing } from "../primitives/focus";

export type ViewTab = { label: string; href: string; current?: boolean };

/**
 * Pages of one screen as a segmented pill of links ("Open · 9 / Upcoming /
 * Done"). The current one carries `aria-current="page"`.
 */
export function ViewTabs({ label, tabs }: { label: string; tabs: ViewTab[] }) {
  return (
    <nav
      aria-label={label}
      className="inline-flex w-fit gap-1 rounded-14 bg-[rgba(30,26,40,0.55)] p-1"
    >
      {tabs.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.current ? "page" : undefined}
          className={`inline-flex min-h-11 cursor-pointer items-center justify-center rounded-10 px-4 font-ui text-sm font-semibold ${
            tab.current
              ? "bg-[rgba(255,255,255,0.18)] text-ink-primary"
              : "text-ink-tertiary hover:bg-white/10 hover:text-ink-primary"
          } ${focusRing}`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
