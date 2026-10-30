import type { AnyRoute } from "@tanstack/react-router";

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
  shortcut?: string;
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}

export interface Shortcut {
  keys: string;
  run: (ctx: CommandContext) => void;
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
  };
  routes: (parent: AnyRoute) => AnyRoute[];
  paletteActions?: PaletteAction[];
  shortcuts?: Shortcut[];
}

export function defineModule(m: ModuleManifest): ModuleManifest {
  return m;
}
