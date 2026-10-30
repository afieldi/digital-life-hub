import { type GlassLevel, GlassPanel } from "../../glass/GlassPanel";
import { registerStories } from "../registry";

const levels: GlassLevel[] = ["panel", "card", "nav", "dialog", "raised"];

registerStories(
  "glass",
  levels.map((level) => ({
    id: `glass/${level}`,
    title: `Glass ${level}`,
    render: () => (
      <GlassPanel level={level} className="w-64 p-5 text-white">
        glass-{level}
      </GlassPanel>
    ),
  })),
);
