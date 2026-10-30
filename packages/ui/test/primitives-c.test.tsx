import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  CalendarDate,
  ComboBox,
  ComboBoxItem,
  DatePicker,
  Time,
  TimeField,
} from "../src";

test("ComboBox filters as you type and Enter selects", async () => {
  const onSel = vi.fn();
  render(
    <ComboBox
      label="Project"
      items={[
        { id: "q4", name: "Q4 planning" },
        { id: "web", name: "Website relaunch" },
      ]}
      onSelectionChange={onSel}
    >
      {(p) => <ComboBoxItem id={p.id}>{p.name}</ComboBoxItem>}
    </ComboBox>,
  );
  await userEvent.type(screen.getByRole("combobox", { name: "Project" }), "q4");
  expect(screen.getAllByRole("option")).toHaveLength(1);
  await userEvent.keyboard("{ArrowDown}{Enter}");
  expect(onSel).toHaveBeenCalledWith("q4");
});

test("DatePicker accepts typed segments", async () => {
  const onChange = vi.fn();
  render(<DatePicker label="Due" onChange={onChange} />);
  await userEvent.click(screen.getByRole("spinbutton", { name: /month/i }));
  await userEvent.keyboard("10302026");
  expect(onChange).toHaveBeenLastCalledWith(new CalendarDate(2026, 10, 30));
  expect(onChange.mock.lastCall?.[0].toString()).toBe("2026-10-30");
});

test("TimeField respects hourCycle 24", () => {
  render(<TimeField label="At" hourCycle={24} value={new Time(14, 30)} />);
  expect(screen.getByRole("spinbutton", { name: /hour/i })).toHaveTextContent(
    "14",
  );
  expect(screen.queryByRole("spinbutton", { name: /AM\/PM/i })).toBeNull();
  expect(screen.queryByText(/^(AM|PM)$/)).toBeNull();
});
