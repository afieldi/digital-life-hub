import type { ReactNode } from "react";

/**
 * A module screen's layout: its header, then a wide main column and a side
 * column that wraps below it on narrow windows, clear of the Dock.
 */
export function ModulePage({
  header,
  main,
  mainLabel,
  aside,
  asideLabel,
}: {
  header: ReactNode;
  main: ReactNode;
  /** Names the main column for screen readers ("Open tasks"). */
  mainLabel: string;
  aside?: ReactNode;
  /** Names the side column; without one it is plain layout. */
  asideLabel?: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-5 px-6 pt-8 pb-[150px]">
      {header}
      <div className="flex flex-wrap items-start gap-6">
        <section
          aria-label={mainLabel}
          className="flex min-w-0 flex-[999_1_560px] flex-col gap-4"
        >
          {main}
        </section>
        {aside === undefined ? null : asideLabel ? (
          <aside
            aria-label={asideLabel}
            className="flex flex-[1_1_280px] flex-col gap-4"
          >
            {aside}
          </aside>
        ) : (
          <div className="flex flex-[1_1_280px] flex-col gap-4">{aside}</div>
        )}
      </div>
    </div>
  );
}
