import type { ElementType, ReactNode } from "react";

export type GlassLevel = "panel" | "card" | "nav" | "dialog" | "raised";

// Literal class names so Tailwind's scanner emits every @utility.
const recipes: Record<GlassLevel, string> = {
  panel: "glass-panel",
  card: "glass-card",
  nav: "glass-nav",
  dialog: "glass-dialog",
  raised: "glass-raised",
};

export function GlassPanel({
  level,
  as: Tag = "div",
  className,
  children,
}: {
  level: GlassLevel;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <Tag
      className={className ? `${recipes[level]} ${className}` : recipes[level]}
    >
      {children}
    </Tag>
  );
}
