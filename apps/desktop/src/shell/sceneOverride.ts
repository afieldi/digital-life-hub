import type { SceneVariant } from "@dlh/ui";
import { createContext, useContext } from "react";

export const SCENE_OVERRIDE_KEY = "dlh.sceneOverride";

const VARIANTS: readonly SceneVariant[] = ["morning", "dusk", "night"];

/** Parse a stored override; anything but a variant name means "automatic". */
export function readSceneOverride(raw: string | null): SceneVariant | null {
  return VARIANTS.find((v) => v === raw) ?? null;
}

export function loadSceneOverride(): SceneVariant | null {
  try {
    return readSceneOverride(localStorage.getItem(SCENE_OVERRIDE_KEY));
  } catch {
    return null;
  }
}

export function saveSceneOverride(value: SceneVariant | null): void {
  try {
    if (value) localStorage.setItem(SCENE_OVERRIDE_KEY, value);
    else localStorage.removeItem(SCENE_OVERRIDE_KEY);
  } catch {
    // Storage unavailable (private mode, quota): the choice lasts this session only.
  }
}

export type SceneOverrideState = {
  override: SceneVariant | null;
  setOverride: (value: SceneVariant | null) => void;
};

export const SceneOverrideContext = createContext<SceneOverrideState>({
  override: null,
  setOverride: () => {},
});

export function useSceneOverride(): SceneOverrideState {
  return useContext(SceneOverrideContext);
}
