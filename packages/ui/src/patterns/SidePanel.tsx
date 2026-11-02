import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { Heading } from "react-aria-components";
import { Button } from "../primitives/Button";

export type SidePanelProps = {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  className?: string;
};

/**
 * A right-hand glass panel. Focus moves into it on open and back to where it was
 * on close; Esc closes it unless something nested (a popover) already handled it.
 */
export function SidePanel({
  title,
  onClose,
  children,
  className,
}: SidePanelProps) {
  const ref = useRef<HTMLElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !e.defaultPrevented) close.current();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (before?.isConnected) before.focus({ preventScroll: true });
    };
  }, []);
  return (
    <aside
      aria-label={title}
      ref={ref}
      tabIndex={-1}
      className={`glass-dialog flex h-full w-[min(26rem,100vw)] flex-col font-ui outline-hidden text-ink-primary ${className ?? ""}`}
    >
      <header className="flex items-start justify-between gap-3 p-5 pb-3">
        <Heading level={2} className="font-serif text-2xl text-ink-primary">
          {title}
        </Heading>
        <Button variant="icon" aria-label="Close" onPress={onClose}>
          <X aria-hidden="true" size={18} />
        </Button>
      </header>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-5 pt-2">
        {children}
      </div>
    </aside>
  );
}
