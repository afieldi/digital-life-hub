import { collectModules, type ModuleManifest } from "@dlh/core";

// Every modules/*/src/manifest.tsx is picked up at build time: adding a module
// needs no edit here.
export const registry = collectModules(
  Object.values(
    import.meta.glob<ModuleManifest>("../../../modules/*/src/manifest.tsx", {
      eager: true,
      import: "default",
    }),
  ),
  // Keys and paths the shell itself owns (Home, Settings, /dev/ui).
  { keys: ["h"], paths: ["/", "/settings", "/dev/ui"] },
);
