import { type ReactNode, useId } from "react";

export type ListGroupProps = {
  label: string;
  /** Shown after the label, muted. */
  count?: number;
  /** `danger` colours the label, as for Overdue. */
  tone?: "default" | "danger";
  /** Beside the heading, e.g. a ghost button. */
  action?: ReactNode;
  children?: ReactNode;
};

/** A labelled run of rows in a list: a small uppercase heading, then the rows. */
export function ListGroup({
  label,
  count,
  tone = "default",
  action,
  children,
}: ListGroupProps) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-0.5 pb-1.5">
      <div className="flex min-h-11 items-center justify-between gap-3 px-3 pt-1">
        <h2
          id={id}
          className={`font-ui text-[13px] leading-[18px] font-semibold tracking-[0.04em] uppercase ${
            tone === "danger" ? "text-type-event" : "text-ink-primary"
          }`}
        >
          {label}
          {count !== undefined ? (
            <>
              {" "}
              <span className="font-medium text-ink-muted">{count}</span>
            </>
          ) : null}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
