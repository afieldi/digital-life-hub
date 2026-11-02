import { X } from "lucide-react";
import type { ReactNode } from "react";
import { Heading } from "react-aria-components";
import { GlassPanel } from "../glass/GlassPanel";
import { Button } from "../primitives/Button";

export type SidePanelProps = {
  title: string;
  onClose: () => void;
  children?: ReactNode;
  className?: string;
};

/** A right-hand glass panel; Esc anywhere inside it closes it. */
export function SidePanel({
  title,
  onClose,
  children,
  className,
}: SidePanelProps) {
  return (
    <GlassPanel
      level="dialog"
      as="aside"
      aria-label={title}
      onKeyDown={(e: React.KeyboardEvent) => {
        if (e.key === "Escape" && !e.defaultPrevented) {
          e.stopPropagation();
          onClose();
        }
      }}
      className={`flex h-full w-[min(26rem,100vw)] flex-col font-ui text-ink-primary ${className ?? ""}`}
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
    </GlassPanel>
  );
}
