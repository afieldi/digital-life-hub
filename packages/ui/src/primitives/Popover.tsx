import {
  Popover as RACPopover,
  type PopoverProps as RACPopoverProps,
} from "react-aria-components";

export type PopoverProps = Omit<RACPopoverProps, "className"> & {
  className?: string;
};

export function Popover({ className, ...props }: PopoverProps) {
  return (
    <RACPopover
      offset={8}
      {...props}
      className={`glass-dialog min-w-40 font-ui text-ink-primary outline-hidden ${className ?? ""}`}
    />
  );
}
