import {
  Button as RACButton,
  type ButtonProps as RACButtonProps,
} from "react-aria-components";
import { focusRing } from "./focus";

export type ButtonVariant = "solid" | "glass" | "ghost" | "dashed" | "icon";

// Literal class names so Tailwind's scanner emits every variant.
const variants: Record<ButtonVariant, string> = {
  solid:
    "rounded-14 bg-link px-5 text-app font-semibold hovered:brightness-105 pressed:brightness-90",
  glass:
    "glass-card rounded-14 border border-white/14 px-5 text-ink-primary hovered:bg-white/15 pressed:bg-white/20",
  ghost:
    "rounded-14 bg-transparent px-4 text-ink-primary hovered:bg-white/10 pressed:bg-white/16",
  dashed:
    "rounded-14 border border-dashed border-white/25 bg-transparent px-5 text-ink-tertiary hovered:bg-white/8 pressed:bg-white/14",
  icon: "glass-card w-11 rounded-14 border border-white/14 text-ink-primary hovered:bg-white/15 pressed:bg-white/20",
};

const base =
  "inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 font-ui text-sm disabled:cursor-not-allowed disabled:opacity-45";

type ButtonBase = Omit<RACButtonProps, "className">;
export type ButtonProps =
  | (ButtonBase & {
      variant?: Exclude<ButtonVariant, "icon">;
      className?: string;
    })
  | (ButtonBase & {
      variant: "icon";
      "aria-label": string;
      className?: string;
    });

export function Button({
  variant = "glass",
  className,
  ...props
}: ButtonProps) {
  return (
    <RACButton
      {...props}
      data-variant={variant}
      className={`${base} ${variants[variant]} ${focusRing}${className ? ` ${className}` : ""}`}
    />
  );
}
