import { useEffect, useRef, useState } from "react";
import { paths, SUN, scenes, VIEW_BOX } from "./mountains";
import {
  type SceneVariant,
  sceneTransitionMs,
  useSceneVariant,
} from "./sceneVariant";

type Layer = { id: number; variant: SceneVariant; fadeMs: number };

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function LayerSet({
  variant,
  fadeMs,
}: {
  variant: SceneVariant;
  fadeMs: number;
}) {
  const p = scenes[variant];
  const [opacity, setOpacity] = useState(fadeMs > 0 ? 0 : 1);
  useEffect(() => {
    if (fadeMs <= 0) return;
    const id = requestAnimationFrame(() => setOpacity(1));
    return () => cancelAnimationFrame(id);
  }, [fadeMs]);
  return (
    <div
      className="absolute inset-0"
      style={{
        background: p.sky,
        opacity,
        transition: fadeMs > 0 ? `opacity ${fadeMs}ms linear` : "none",
      }}
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox={VIEW_BOX}
        preserveAspectRatio="xMidYMax slice"
        role="presentation"
        aria-hidden="true"
      >
        <circle
          cx={SUN.cx}
          cy={SUN.cy}
          r={SUN.r}
          opacity={SUN.opacity}
          fill={p.sun}
        />
        <path d={paths.far} fill={p.far} />
        <path d={paths.mid} fill={p.mid} />
        <path d={paths.near} fill={p.near} />
      </svg>
    </div>
  );
}

export function Scene({ variant }: { variant?: SceneVariant }) {
  const current = useSceneVariant(variant);
  const nextId = useRef(1);
  const lastPick = useRef(variant);
  // First mount renders the variant immediately (no fade); later changes cross-fade.
  const [layers, setLayers] = useState<Layer[]>([
    { id: 0, variant: current, fadeMs: 0 },
  ]);

  useEffect(() => {
    // A change of the `variant` prop is a pick; otherwise the clock moved.
    const picked = variant !== lastPick.current;
    lastPick.current = variant;
    const ms = sceneTransitionMs(
      prefersReducedMotion(),
      picked ? "picked" : "clock",
    );
    let timer: ReturnType<typeof setTimeout> | undefined;
    setLayers((ls) => {
      if (ls[ls.length - 1].variant === current) return ls;
      const next = { id: nextId.current++, variant: current, fadeMs: ms };
      return ms === 0 ? [next] : [...ls, next];
    });
    if (ms > 0) {
      timer = setTimeout(() => setLayers((ls) => ls.slice(-1)), ms + 100);
    }
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [current, variant]);

  return (
    <div
      data-testid="scene"
      data-variant={current}
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden"
      style={{ zIndex: -1 }}
    >
      {layers.map((l) => (
        <LayerSet key={l.id} variant={l.variant} fadeMs={l.fadeMs} />
      ))}
    </div>
  );
}
