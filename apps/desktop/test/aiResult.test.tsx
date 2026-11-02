import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AiResult } from "../src/ai/AiResult";
import { registry } from "../src/modules";

const id = "01a19dab-01b0-7a77-8e92-851a6b8a4296";

test("listed renders rows", async () => {
  const onOpen = vi.fn();
  render(
    <AiResult
      state={{
        phase: "listed",
        provider: "openrouter",
        result: {
          requestId: "r",
          status: "listed",
          heading: "Due today",
          items: [{ id, type: "task", title: "Pay rent", archivedAt: null }],
        },
      }}
      providerName="OpenRouter"
      errorActions={[]}
      onUse={() => {}}
      onNone={() => {}}
      onCancel={() => {}}
      onClose={() => {}}
      onOpen={onOpen}
    />,
  );
  expect(screen.getByText("Due today")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Pay rent" }));
  expect(onOpen).toHaveBeenCalledWith(registry.itemTypes.get("task")?.href(id));
});
