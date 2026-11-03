import {
  type AiActionDescription,
  coreAiActions,
  type ModuleRegistry,
} from "@dlh/core";
import { useMemo } from "react";
import { useRegistry } from "../modules";

/** Every AI action `registry`'s app knows: the core ones and those modules add. */
export function allActions(registry: ModuleRegistry): AiActionDescription[] {
  return [...Object.values(coreAiActions), ...registry.aiActions];
}

/** `allActions` for the registry the shell runs with. */
export function useAllActions(): AiActionDescription[] {
  const registry = useRegistry();
  return useMemo(() => allActions(registry), [registry]);
}
