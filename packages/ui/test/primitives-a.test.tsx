import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Button } from "../src/primitives/Button";
import { Checkbox } from "../src/primitives/Checkbox";
import { SearchField } from "../src/primitives/SearchField";
import { Switch } from "../src/primitives/Switch";
import { TextField } from "../src/primitives/TextField";

test("Checkbox toggles with Space and with click", async () => {
  const onChange = vi.fn();
  render(<Checkbox onChange={onChange}>Buy milk</Checkbox>);
  const box = screen.getByRole("checkbox", { name: "Buy milk" });
  await userEvent.click(box);
  expect(onChange).toHaveBeenLastCalledWith(true);
  box.focus();
  await userEvent.keyboard(" ");
  expect(onChange).toHaveBeenLastCalledWith(false);
});

test("Button variants set data-variant and fire onPress from Enter", async () => {
  const onPress = vi.fn();
  render(
    <Button variant="dashed" onPress={onPress}>
      + Add card
    </Button>,
  );
  const b = screen.getByRole("button", { name: "+ Add card" });
  expect(b).toHaveAttribute("data-variant", "dashed");
  b.focus();
  await userEvent.keyboard("{Enter}");
  expect(onPress).toHaveBeenCalledOnce();
});

test("Button defaults to glass variant", () => {
  render(<Button>Go</Button>);
  expect(screen.getByRole("button")).toHaveAttribute("data-variant", "glass");
});

test("TextField links label and error", () => {
  render(<TextField label="Title" isInvalid errorMessage="Required" />);
  expect(
    screen.getByRole("textbox", { name: "Title" }),
  ).toHaveAccessibleDescription("Required");
});

test("TextField links description", () => {
  render(<TextField label="Title" description="Shown on the card" />);
  expect(
    screen.getByRole("textbox", { name: "Title" }),
  ).toHaveAccessibleDescription("Shown on the card");
});

test("SearchField clears with Escape", async () => {
  render(<SearchField label="Search" defaultValue="vendor" />);
  const input = screen.getByRole("searchbox");
  input.focus();
  await userEvent.keyboard("{Escape}");
  expect(input).toHaveValue("");
});

test("SearchField renders shortcut text", () => {
  render(<SearchField label="Search" shortcut="⌘K" />);
  expect(screen.getByText("⌘K")).toBeInTheDocument();
});

test("Switch exposes role switch", () => {
  render(<Switch>Use 24h</Switch>);
  expect(screen.getByRole("switch", { name: "Use 24h" })).toBeInTheDocument();
});

test("Switch toggles with click and with Space", async () => {
  const onChange = vi.fn();
  render(<Switch onChange={onChange}>Use 24h</Switch>);
  const sw = screen.getByRole("switch", { name: "Use 24h" });
  await userEvent.click(sw);
  expect(onChange).toHaveBeenLastCalledWith(true);
  expect(sw).toBeChecked();
  sw.focus();
  await userEvent.keyboard(" ");
  expect(onChange).toHaveBeenLastCalledWith(false);
});

test("SearchField clear button empties the input", async () => {
  render(<SearchField label="Search" defaultValue="vendor" />);
  await userEvent.click(screen.getByRole("button", { name: "Clear search" }));
  expect(screen.getByRole("searchbox")).toHaveValue("");
});

test("disabled Button does not fire onPress", async () => {
  const onPress = vi.fn();
  render(
    <Button isDisabled onPress={onPress}>
      Nope
    </Button>,
  );
  await userEvent.click(screen.getByRole("button", { name: "Nope" }));
  expect(onPress).not.toHaveBeenCalled();
});

test("icon Button requires aria-label at the type level", () => {
  // @ts-expect-error icon variant without aria-label must not compile
  const bad = <Button variant="icon">x</Button>;
  const good = (
    <Button variant="icon" aria-label="Settings">
      x
    </Button>
  );
  expect([bad, good]).toHaveLength(2);
});
