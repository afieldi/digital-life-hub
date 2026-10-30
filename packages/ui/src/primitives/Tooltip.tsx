import {
  Tooltip as RACTooltip,
  type TooltipProps as RACTooltipProps,
  TooltipTrigger,
} from "react-aria-components";

export { TooltipTrigger };

export type TooltipProps = Omit<
  RACTooltipProps,
  "className" | "UNSTABLE_portalContainer"
> & {
  className?: string;
  /** Render inside this element instead of document.body (gallery/screenshots). */
  portalContainer?: Element | null;
};

export function Tooltip({
  className,
  portalContainer,
  ...props
}: TooltipProps) {
  return (
    <RACTooltip
      offset={8}
      {...props}
      UNSTABLE_portalContainer={portalContainer ?? undefined}
      className={`glass-raised px-3 py-1.5 font-ui text-xs text-ink-primary${className ? ` ${className}` : ""}`}
    />
  );
}
