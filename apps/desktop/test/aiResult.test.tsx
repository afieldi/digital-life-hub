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
          items: [
            {
              id,
              type: "task",
              title: "Pay rent",
              archivedAt: null,
              note: "It's due today",
            },
            {
              id: "01a19dab-01b0-7a77-8e92-851a6b8a4297",
              type: "task",
              title: "Water plants",
              archivedAt: null,
              done: true,
            },
          ],
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
  // A row's note (Plan today's reason) shows under its title.
  const row = screen.getByRole("button", { name: /^Pay rent/ });
  expect(row).toHaveTextContent("It's due today");
  // Finished since the plan was made: struck through, and said so.
  const done = screen.getByRole("button", { name: /^Water plants/ });
  expect(done).toHaveTextContent("Done");
  expect(screen.getByText("Water plants")).toHaveClass("line-through");
  await userEvent.click(row);
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

test("a suggested option shows its preview text under the label", () => {
  render(
    <AiResult
      state={{
        phase: "suggested",
        provider: "openrouter",
        result: {
          requestId: "r",
          status: "suggested",
          options: [
            { label: "Shorter", reason: "Ask about the fee." },
            { label: "Clearer", reason: "Ask the bank\nabout the fee." },
          ],
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
      onOpen={() => {}}
    />,
  );
  expect(screen.getByText("Ask about the fee.")).toBeInTheDocument();
  expect(
    screen.getByText(/Ask the bank\s+about the fee\./),
  ).toBeInTheDocument();
  expect(screen.getAllByRole("button", { name: /^Use / })).toHaveLength(2);
});
