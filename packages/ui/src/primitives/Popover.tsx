import {
  Popover as RACPopover,
  type PopoverProps as RACPopoverProps,
} from "react-aria-components";

export type PopoverProps = Omit<
  RACPopoverProps,
  "className" | "UNSTABLE_portalContainer"
> & {
  className?: string;
  /** Render the popover inside this element instead of document.body (gallery/screenshots). */
  portalContainer?: Element | null;
};

export function Popover({
  className,
  portalContainer,
  ...props
}: PopoverProps) {
  return (
    <RACPopover
      offset={8}
      {...props}
      UNSTABLE_portalContainer={portalContainer ?? undefined}
      className={`glass-dialog min-w-40 font-ui text-ink-primary outline-hidden ${className ?? ""}`}
    />
  );
}
