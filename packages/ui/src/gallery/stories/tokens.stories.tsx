import { registerStories } from "../registry";

// Written out in full: Tailwind emits only the theme variables it finds by name.
const TYPE_COLORS = [
  "var(--color-type-task)",
  "var(--color-type-request)",
  "var(--color-type-note)",
  "var(--color-type-project)",
  "var(--color-type-event)",
  "var(--color-type-ai)",
];

registerStories("tokens", [
  {
    id: "tokens/swatches",
    title: "Type colour swatches",
    render: () => (
      <div className="flex gap-3">
        {TYPE_COLORS.map((color) => (
          <div
            key={color}
            title={color}
            className="size-16 rounded-xl"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    ),
  },
]);
