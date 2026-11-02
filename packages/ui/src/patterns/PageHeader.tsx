import type { ReactNode } from "react";

/** A screen's title (serif, as on Home) with an optional line under it. */
export function PageHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-1.5">
      <h1 className="font-serif text-[40px] leading-tight font-normal text-ink-primary">
        {title}
      </h1>
      {subtitle ? (
        <p className="font-ui text-[15px] text-ink-secondary">{subtitle}</p>
      ) : null}
    </header>
  );
}
