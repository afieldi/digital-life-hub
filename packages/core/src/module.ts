import type { AnyRoute } from "@tanstack/react-router";
import type { ComponentType } from "react";
import type { AiActionDescription } from "./ai/actions";
import type { OperationDescription } from "./operations/describe";

export interface CommandContext {
  pathname: string;
  itemId?: string;
  selectedText?: string;
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
  /** Widgets for the Home screen. Provisional until the Home spec: nothing renders these yet. */
  homeWidgets?: { id: string; label: string; component: ComponentType }[];
  routes: (parent: AnyRoute) => AnyRoute[];
  paletteActions?: PaletteAction[];
  aiActions?: AiActionDescription[];
  operations?: OperationDescription[];
}

export function defineModule(m: ModuleManifest): ModuleManifest {
  return m;
}
