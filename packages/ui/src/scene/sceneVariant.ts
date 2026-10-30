import { useEffect, useState } from "react";

export type SceneVariant = "morning" | "dusk" | "night";

export function sceneVariantFor(date: Date): SceneVariant {
  const h = date.getHours();
  if (h >= 5 && h < 17) return "morning";
  if (h >= 17 && h < 21) return "dusk";
  return "night";
}

/** Why the scene changed: the clock crossing a boundary, or a variant picked by hand. */
export type SceneChange = "clock" | "picked";

export function sceneTransitionMs(
  reducedMotion: boolean,
  change: SceneChange = "clock",
): number {
  if (reducedMotion) return 0;
  return change === "picked" ? 500 : 60000;
}

export function useSceneVariant(
  override?: SceneVariant | null,
  now: () => Date = () => new Date(),
): SceneVariant {
  const [clock, setClock] = useState<SceneVariant>(() =>
    sceneVariantFor(now()),
  );
  // biome-ignore lint/correctness/useExhaustiveDependencies: `now` is a stable-by-convention clock source
  useEffect(() => {
    const id = setInterval(() => setClock(sceneVariantFor(now())), 60_000);
    return () => clearInterval(id);
  }, []);
  return override ?? clock;
}
