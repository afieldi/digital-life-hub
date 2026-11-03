import {
  collectModules,
  type ModuleManifest,
  type ModuleRegistry,
} from "@dlh/core";
import { createContext, useContext } from "react";

/** Keys and paths the shell itself owns (Home, Settings, /dev/ui). */
export const SHELL_RESERVED = {
  keys: ["h"],
  paths: ["/", "/settings", "/dev/ui"],
};

// Every modules/*/src/manifest.tsx is picked up at build time: adding a module
// needs no edit here.
export const registry = collectModules(
  Object.values(
    import.meta.glob<ModuleManifest>("../../../modules/*/src/manifest.tsx", {
      eager: true,
      import: "default",
    }),
  ),
  SHELL_RESERVED,
);

/** The registry the shell runs with: the app's, or one a test builds (`createAppRouter`). */
export const RegistryContext = createContext<ModuleRegistry>(registry);

export function useRegistry(): ModuleRegistry {
  return useContext(RegistryContext);
}
