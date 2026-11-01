import type { AiActionDescription } from "./ai/actions";
import type { ModuleManifest, PaletteAction } from "./module";

export class ModuleRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleRegistryError";
  }
}

export interface ModuleRegistry {
  modules: ModuleManifest[];
  nav: NonNullable<ModuleManifest["nav"]>[];
  itemTypes: Map<string, NonNullable<ModuleManifest["itemType"]>>;
  actions: PaletteAction[];
  aiActions: AiActionDescription[];
}

export interface ReservedShell {
  keys?: string[];
  paths?: string[];
}

export function collectModules(
  manifests: ModuleManifest[],
  reserved: ReservedShell = {},
): ModuleRegistry {
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  const keys = new Map<string, string>();
  const nav: ModuleRegistry["nav"] = [];
  const itemTypes: ModuleRegistry["itemTypes"] = new Map();
  const itemTypeOwners = new Map<string, string>();
  const actions: PaletteAction[] = [];
  const actionOwners = new Map<string, string>();
  const aiActions: AiActionDescription[] = [];
  const aiActionOwners = new Map<string, string>();

  for (const m of manifests) {
    if (ids.has(m.id))
      throw new ModuleRegistryError(`Duplicate module id "${m.id}"`);
    ids.add(m.id);

    if (m.nav) {
      if (reserved.paths?.includes(m.nav.path)) {
        throw new ModuleRegistryError(
          `Module "${m.id}" uses nav path "${m.nav.path}", which is reserved by the shell`,
        );
      }
      if (m.nav.key !== undefined) {
        if (!/^[a-z]$/.test(m.nav.key)) {
          throw new ModuleRegistryError(
            `Module "${m.id}" has invalid nav key "${m.nav.key}": must be a single letter a-z`,
          );
        }
        if (reserved.keys?.includes(m.nav.key)) {
          throw new ModuleRegistryError(
            `Module "${m.id}" uses nav key "${m.nav.key}", which is reserved by the shell`,
          );
        }
      }
      const owner = paths.get(m.nav.path);
      if (owner) {
        throw new ModuleRegistryError(
          `Duplicate nav path "${m.nav.path}" in modules "${owner}" and "${m.id}"`,
        );
      }
      paths.set(m.nav.path, m.id);
      if (m.nav.key) {
        const keyOwner = keys.get(m.nav.key);
        if (keyOwner) {
          throw new ModuleRegistryError(
            `Duplicate shortcut "g ${m.nav.key}" in modules "${keyOwner}" and "${m.id}"`,
          );
        }
        keys.set(m.nav.key, m.id);
      }
      nav.push(m.nav);
    }

    if (m.itemType) {
      const owner = itemTypeOwners.get(m.itemType.type);
      if (owner) {
        throw new ModuleRegistryError(
          `Duplicate item type "${m.itemType.type}" in modules "${owner}" and "${m.id}"`,
        );
      }
      itemTypeOwners.set(m.itemType.type, m.id);
      itemTypes.set(m.itemType.type, m.itemType);
    }

    for (const a of m.paletteActions ?? []) {
      const owner = actionOwners.get(a.id);
      if (owner) {
        throw new ModuleRegistryError(
          `Duplicate palette action id "${a.id}" in modules "${owner}" and "${m.id}"`,
        );
      }
      actionOwners.set(a.id, m.id);
      actions.push(a);
    }

    for (const a of m.aiActions ?? []) {
      const owner = aiActionOwners.get(a.id);
      if (owner) {
        throw new ModuleRegistryError(
          `Duplicate AI action id "${a.id}" in modules "${owner}" and "${m.id}"`,
        );
      }
      aiActionOwners.set(a.id, m.id);
      aiActions.push(a);
    }
  }

  nav.sort((a, b) => a.order - b.order);
  return { modules: manifests, nav, itemTypes, actions, aiActions };
}
