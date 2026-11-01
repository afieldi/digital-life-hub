import { coreAiActions, describeAiAction } from "@dlh/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { allowedKinds, kindLine, UnderstoodAs } from "../src/ai/UnderstoodAs";

const { answer, retitle, delete: del } = coreAiActions;

test("shows the AI tile, the action's label and only the kinds it allows", () => {
  render(
    <UnderstoodAs
      action={retitle}
      kind="do"
      confidence={1}
      providerName="Claude Code"
      onKindChange={() => {}}
    />,
  );
  expect(screen.getByTestId("type-tile")).toHaveAttribute("data-type", "ai");
  expect(screen.getByText("Rename")).toBeInTheDocument();
  const kinds = screen.getAllByRole("radio").map((r) => r.textContent);
  expect(kinds).toEqual(["Suggest", "Do"]);
  expect(screen.getByRole("radio", { name: "Do" })).toBeChecked();
  expect(
    screen.getByText("Changes it now, with Undo after · Claude Code"),
  ).toBeInTheDocument();
  expect(screen.queryByText("Not sure")).toBeNull();
});

test("each kind has its line", () => {
  expect(kindLine(answer, "ask")).toBe("Answers only, changes nothing");
  expect(kindLine(retitle, "suggest")).toBe(
    "Shows options, changes nothing until you pick",
  );
  expect(kindLine(retitle, "do")).toBe("Changes it now, with Undo after");
});

test("a delete capped below Do says it is always shown first", () => {
  render(
    <UnderstoodAs
      action={del}
      kind="suggest"
      confidence={1}
      providerName="OpenRouter"
      onKindChange={() => {}}
    />,
  );
  expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
    "Suggest",
  ]);
  expect(
    screen.getByText("Deletes always show you first · OpenRouter"),
  ).toBeInTheDocument();
});

test("allowed kinds respect the cap even when the action lists more", () => {
  const archive = describeAiAction({
    id: "archiveIt",
    label: "Archive",
    description: "Archives the item.",
    appliesTo: "*",
    kinds: ["suggest", "do"],
    effects: ["setArchived"],
  });
  expect(allowedKinds(archive)).toEqual(["suggest"]);
  expect(allowedKinds(retitle)).toEqual(["suggest", "do"]);
  expect(allowedKinds(answer)).toEqual(["ask"]);
});

test("low confidence shows Not sure", () => {
  const { rerender } = render(
    <UnderstoodAs
      action={answer}
      kind="ask"
      confidence={0.59}
      onKindChange={() => {}}
    />,
  );
  expect(screen.getByText("Not sure")).toBeInTheDocument();
  expect(screen.getByText("Answers only, changes nothing")).toBeInTheDocument();
  rerender(
    <UnderstoodAs
      action={answer}
      kind="ask"
      confidence={0.6}
      onKindChange={() => {}}
    />,
  );
  expect(screen.queryByText("Not sure")).toBeNull();
});

test("clicking a kind asks to switch to it", async () => {
  const onKindChange = vi.fn();
  render(
    <UnderstoodAs
      action={retitle}
      kind="do"
      confidence={1}
      onKindChange={onKindChange}
    />,
  );
  await userEvent.click(screen.getByRole("radio", { name: "Suggest" }));
  expect(onKindChange).toHaveBeenCalledWith("suggest");
});
