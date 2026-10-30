import {
  Tooltip as RACTooltip,
  type TooltipProps as RACTooltipProps,
  TooltipTrigger,
} from "react-aria-components";

export { TooltipTrigger };

export type TooltipProps = Omit<RACTooltipProps, "className"> & {
  className?: string;
};

export function Tooltip({ className, ...props }: TooltipProps) {
  return (
    <RACTooltip
      offset={8}
      {...props}
      className={`glass-raised px-3 py-1.5 font-ui text-xs text-ink-primary ${className ?? ""}`}
    />
  );
}
