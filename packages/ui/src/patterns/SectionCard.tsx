import { type ReactNode, useId } from "react";
import { Link } from "react-aria-components";
import { focusRing } from "../primitives/focus";

export type SectionCardProps = {
  title: string;
  action?: { label: string; href: string };
  children?: ReactNode;
  className?: string;
};

export function SectionCard({
  title,
  action,
  children,
  className,
}: SectionCardProps) {
  const headingId = useId();
  return (
    <section
      aria-labelledby={headingId}
      className={`glass-panel flex flex-col gap-3 p-5 font-ui text-ink-primary ${className ?? ""}`}
    >
      <header className="flex min-h-11 items-center justify-between gap-3">
        <h2 id={headingId} className="text-[17px] font-semibold">
          {title}
        </h2>
        {action ? (
          <Link
            href={action.href}
            className={`inline-flex min-h-11 items-center rounded-10 px-1 text-sm font-medium text-link hover:underline ${focusRing}`}
          >
            {action.label}
          </Link>
        ) : null}
      </header>
      {children}
    </section>
  );
}
