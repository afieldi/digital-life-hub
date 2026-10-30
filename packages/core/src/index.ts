export type {
  CommandContext,
  ModuleManifest,
  PaletteAction,
} from "./module";
export { defineModule } from "./module";
export type { ModuleRegistry, ReservedShell } from "./registry";
export { collectModules, ModuleRegistryError } from "./registry";
