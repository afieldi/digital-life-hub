import { typeColors } from "../../tokens";
import { registerStories } from "../registry";

registerStories("tokens", [
  {
    id: "tokens/swatches",
    title: "Type colour swatches",
    render: () => (
      <div className="flex gap-3">
        {Object.entries(typeColors).map(([name, color]) => (
          <div
            key={name}
            title={name}
            className="size-16 rounded-xl"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    ),
  },
]);
