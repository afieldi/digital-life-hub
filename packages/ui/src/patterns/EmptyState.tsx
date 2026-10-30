import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  body?: string;
  action?: ReactNode;
};

export function EmptyState({
  icon: Icon,
  title,
  body,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center font-ui">
      <span className="glass-card flex size-14 items-center justify-center rounded-full text-ink-secondary">
        <Icon aria-hidden="true" size={26} strokeWidth={1.75} />
      </span>
      <p className="text-[17px] font-semibold text-ink-primary">{title}</p>
      {body ? (
        <p className="max-w-[32ch] text-sm text-ink-tertiary">{body}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
