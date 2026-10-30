import { paths, scenes, VIEW_BOX } from "../../scene/mountains";
import type { SceneVariant } from "../../scene/sceneVariant";
import { registerStories } from "../registry";

// Scene is fixed full-window, so stories show a framed preview of each palette.
function Preview({ variant }: { variant: SceneVariant }) {
  const p = scenes[variant];
  return (
    <div
      className="relative h-48 w-80 overflow-hidden rounded-2xl"
      style={{ background: p.sky }}
    >
      <svg
        className="absolute inset-0 size-full"
        viewBox={VIEW_BOX}
        preserveAspectRatio="xMidYMax slice"
        role="presentation"
        aria-hidden="true"
      >
        <circle cx={980} cy={470} r={70} opacity={0.85} fill={p.sun} />
        <path d={paths.far} fill={p.far} />
        <path d={paths.mid} fill={p.mid} />
        <path d={paths.near} fill={p.near} />
      </svg>
    </div>
  );
}

registerStories(
  "scene",
  (["morning", "dusk", "night"] as const).map((v) => ({
    id: `scene/${v}`,
    title: `Scene ${v}`,
    render: () => <Preview variant={v} />,
  })),
);
