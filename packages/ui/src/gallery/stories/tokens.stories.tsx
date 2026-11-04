import { registerStories } from "../registry";

const TYPE_COLORS = ["task", "request", "note", "project", "event", "ai"];

registerStories("tokens", [
  {
    id: "tokens/swatches",
    title: "Type colour swatches",
    render: () => (
      <div className="flex gap-3">
        {TYPE_COLORS.map((name) => (
          <div
            key={name}
            title={name}
            className="size-16 rounded-xl"
            style={{ backgroundColor: `var(--color-type-${name})` }}
          />
        ))}
      </div>
    ),
  },
]);
