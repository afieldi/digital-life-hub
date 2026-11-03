import type { AnyRoute } from "@tanstack/react-router";
import type { ComponentType } from "react";
import type { AiActionDescription } from "./ai/actions";
import type { OperationDescription } from "./operations/describe";

/** What a palette action knows when ⌘K shows or runs it. */
export interface CommandContext {
  pathname: string;
  /** The item whose page is on screen, if any. */
  itemId?: string;
  navigate: (to: string) => void;
}

export interface PaletteAction {
  id: string;
  label: string | ((ctx: CommandContext) => string);
  icon?: string;
  group: "create" | "actions" | "ai";
  keywords?: string[];
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

/** A panel a module puts on Home. It runs inside the API and query providers. */
export interface HomeWidget {
  /** Unique within its module. */
  id: string;
  label: string;
  component: ComponentType;
  /** Lower comes first; modules' widgets without one follow, in registry order. */
  order?: number;
}

export interface ModuleManifest {
  id: string;
  itemType?: {
    type: string;
    label: string;
    glyph: string;
    color: string;
    href: (id: string) => string;
  };
  nav?: {
    label: string;
    icon: string;
    path: string;
    order: number;
    key?: string;
    /** Rendered after the label in the Dock, e.g. an open count. It runs inside the API and query providers, so it may call hooks that need them. */
    badge?: ComponentType;
  };
  /** Panels for the Home screen, which the Home module lays out in `order`. */
  homeWidgets?: HomeWidget[];
  routes: (parent: AnyRoute) => AnyRoute[];
  paletteActions?: PaletteAction[];
  aiActions?: AiActionDescription[];
  operations?: OperationDescription[];
}

export function defineModule(m: ModuleManifest): ModuleManifest {
  return m;
}
