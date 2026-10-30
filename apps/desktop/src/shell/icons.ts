import { icons, type LucideIcon, Puzzle } from "lucide-react";

/** Resolve a manifest's Lucide icon name; unknown names fall back to a puzzle piece. */
export function iconFor(name: string | undefined): LucideIcon {
  return (name && (icons as Record<string, LucideIcon>)[name]) || Puzzle;
}
