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

/**
 * A panel a module adds to another module's item page, so the owner needs no
 * import of it (Agent's panel on a task). It runs inside the API and query providers.
 */
export interface DetailPanel {
  /** The item type whose page shows it. */
  itemType: string;
  /** Unique within its module. */
  id: string;
  label: string;
  component: ComponentType<{ itemId: string }>;
  /** Lower comes first; panels without one follow, in registry order. */
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
  /**
   * Other modules' item types this module's screens show (Requests shows its
   * tasks): their changes refresh this module's queries too. A module's query
   * keys start with its id.
   */
  refreshOn?: string[];
  /** Panels for the Home screen, which the Home module lays out in `order`. */
  homeWidgets?: HomeWidget[];
  /** Panels this module adds to item pages, whichever module owns them. */
  detailPanels?: DetailPanel[];
  routes: (parent: AnyRoute) => AnyRoute[];
  paletteActions?: PaletteAction[];
  aiActions?: AiActionDescription[];
  operations?: OperationDescription[];
}

/**
 * What a module is and does, shared by its manifest (`defineModule`) and its
 * server module (`defineServerModule`), so the two can't disagree. It lives in
 * the module's React- and server-free `src/module.ts`.
 */
export type ModuleDescription<
  Id extends string = string,
  Ops extends Record<string, OperationDescription> = Record<
    string,
    OperationDescription
  >,
> = {
  id: Id;
  /** The only values `items.type` may hold for this module. */
  itemTypes: readonly string[];
  /** Keyed as mounted: `operations.complete` is the procedure `<id>.complete`. */
  operations: Ops;
  /** Hand-written AI actions; operations are AI actions on their own. */
  aiActions: readonly AiActionDescription[];
};

export class ModuleDescriptionError extends Error {
  override name = "ModuleDescriptionError";
}

export function describeModule<
  const Id extends string,
  const Ops extends Record<string, OperationDescription> = Record<never, never>,
>(d: {
  id: Id;
  itemTypes: readonly string[];
  operations?: Ops;
  aiActions?: readonly AiActionDescription[];
}): ModuleDescription<Id, Ops> {
  const operations = d.operations ?? ({} as Ops);
  for (const [key, op] of Object.entries(operations)) {
    if (op.id !== `${d.id}.${key}`) {
      throw new ModuleDescriptionError(
        `Module "${d.id}" mounts operation "${op.id}" as "${key}": its id must be "${d.id}.${key}"`,
      );
    }
  }
  return {
    id: d.id,
    itemTypes: d.itemTypes,
    operations,
    aiActions: d.aiActions ?? [],
  };
}

/** The manifest fields a module's description supplies. */
type Described = "id" | "operations" | "aiActions";

/**
 * A module's client half. With a description, its id, operations and AI
 * actions come from it, and its item type must be one it declares.
 */
export function defineModule(m: ModuleManifest): ModuleManifest;
export function defineModule(
  desc: ModuleDescription,
  ui: Omit<ModuleManifest, Described>,
): ModuleManifest;
export function defineModule(
  a: ModuleManifest | ModuleDescription,
  ui?: Omit<ModuleManifest, Described>,
): ModuleManifest {
  // Only a description has `itemTypes` (a manifest has one `itemType`).
  if (!("itemTypes" in a)) return a;
  const desc = a;
  if (!ui) {
    throw new ModuleDescriptionError(`Module "${desc.id}" has no manifest`);
  }
  if (ui.itemType && !desc.itemTypes.includes(ui.itemType.type)) {
    throw new ModuleDescriptionError(
      `Module "${desc.id}" shows item type "${ui.itemType.type}" but declares ${JSON.stringify(desc.itemTypes)}`,
    );
  }
  return {
    ...ui,
    id: desc.id,
    operations: Object.values(desc.operations),
    aiActions: [...desc.aiActions],
  };
}
