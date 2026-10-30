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
}

export function collectModules(manifests: ModuleManifest[]): ModuleRegistry {
  const ids = new Set<string>();
  const paths = new Map<string, string>();
  const keys = new Map<string, string>();
  const nav: ModuleRegistry["nav"] = [];
  const itemTypes: ModuleRegistry["itemTypes"] = new Map();
  const itemTypeOwners = new Map<string, string>();
  const actions: PaletteAction[] = [];

  for (const m of manifests) {
    if (ids.has(m.id))
      throw new ModuleRegistryError(`Duplicate module id "${m.id}"`);
    ids.add(m.id);

    if (m.nav) {
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

    if (m.paletteActions) actions.push(...m.paletteActions);
  }

  nav.sort((a, b) => a.order - b.order);
  return { modules: manifests, nav, itemTypes, actions };
}
