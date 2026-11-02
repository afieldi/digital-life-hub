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
      ticked={[]}
      onToggle={() => {}}
      onAddTicked={() => {}}
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

test("a multiSelect suggestion is a checklist; Add selected needs a tick", async () => {
  const onToggle = vi.fn();
  const onAddTicked = vi.fn();
  const props = {
    state: {
      phase: "suggested" as const,
      provider: "openrouter" as const,
      result: {
        requestId: "r",
        status: "suggested" as const,
        multiSelect: true,
        options: [{ label: "Book hotel" }, { label: "Pack bags" }],
      },
    },
    providerName: "OpenRouter",
    errorActions: [],
    onUse: () => {},
    onToggle,
    onAddTicked,
    onNone: () => {},
    onCancel: () => {},
    onClose: () => {},
    onOpen: () => {},
  };
  const { rerender } = render(<AiResult {...props} ticked={[1]} />);
  expect(
    screen.getByRole("checkbox", { name: "Book hotel" }),
  ).not.toBeChecked();
  expect(screen.getByRole("checkbox", { name: "Pack bags" })).toBeChecked();
  expect(screen.queryByRole("button", { name: /^Use / })).toBeNull();
  await userEvent.click(screen.getByRole("checkbox", { name: "Book hotel" }));
  expect(onToggle).toHaveBeenCalledWith(0);
  await userEvent.click(screen.getByRole("button", { name: "Add selected" }));
  expect(onAddTicked).toHaveBeenCalledTimes(1);
  rerender(<AiResult {...props} ticked={[]} />);
  expect(screen.getByRole("button", { name: "Add selected" })).toBeDisabled();
});
