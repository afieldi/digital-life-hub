import { CalendarDate, Time } from "@internationalized/date";
import { useEffect, useRef } from "react";
import { ComboBox, ComboBoxItem } from "../../primitives/ComboBox";
import { DatePicker } from "../../primitives/DatePicker";
import { TimeField } from "../../primitives/TimeField";
import { registerStories } from "../registry";
import { OverlayBox } from "./OverlayBox";

const projects = [
  { id: "q4", name: "Q4 planning" },
  { id: "web", name: "Website relaunch" },
  { id: "home", name: "Home renovation" },
];
const item = (p: { id: string; name: string }) => (
  <ComboBoxItem id={p.id}>{p.name}</ComboBoxItem>
);
// RAC's ComboBox has no controlled open state, so the open story focuses the
// input and presses ArrowDown once, exactly as a keyboard user would.
function OpenOnMount({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    // Wait a frame so RAC has built the collection before opening.
    const id = requestAnimationFrame(() => {
      const input = ref.current?.querySelector("input");
      input?.focus();
      input?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return <div ref={ref}>{children}</div>;
}
const box = "w-[440px] p-6";

registerStories("primitives-c", [
  {
    id: "primitives/combobox",
    title: "ComboBox",
    render: () => (
      <div className={box}>
        <ComboBox label="Project" items={projects} placeholder="Find a project">
          {item}
        </ComboBox>
      </div>
    ),
  },
  {
    id: "primitives/combobox-focus",
    title: "ComboBox (focus)",
    render: () => (
      <div className={box}>
        <div data-force-focus>
          <ComboBox label="Project" items={projects} defaultInputValue="">
            {item}
          </ComboBox>
        </div>
      </div>
    ),
  },
  {
    id: "primitives/combobox-open",
    title: "ComboBox (open)",
    render: () => (
      <OverlayBox height={300}>
        {(c) => (
          <OpenOnMount>
            <div className="p-4">
              <ComboBox
                label="Project"
                items={projects}
                defaultInputValue="o"
                portalContainer={c}
                popoverProps={{
                  isNonModal: true,
                  shouldFlip: false,
                  className: "max-h-none!",
                }}
              >
                {item}
              </ComboBox>
            </div>
          </OpenOnMount>
        )}
      </OverlayBox>
    ),
  },
  {
    id: "primitives/combobox-disabled",
    title: "ComboBox (disabled)",
    render: () => (
      <div className={box}>
        <ComboBox label="Project" items={projects} isDisabled>
          {item}
        </ComboBox>
      </div>
    ),
  },
  {
    id: "primitives/combobox-invalid",
    title: "ComboBox (invalid)",
    render: () => (
      <div className={box}>
        <ComboBox
          label="Project"
          items={projects}
          isInvalid
          errorMessage="Pick a project from the list"
        >
          {item}
        </ComboBox>
      </div>
    ),
  },
  {
    id: "primitives/datepicker",
    title: "DatePicker",
    render: () => (
      <div className={box}>
        <DatePicker label="Due" defaultValue={new CalendarDate(2026, 10, 30)} />
      </div>
    ),
  },
  {
    id: "primitives/datepicker-focus",
    title: "DatePicker (focus)",
    render: () => (
      <div className={box}>
        <div data-force-focus>
          <DatePicker
            label="Due"
            defaultValue={new CalendarDate(2026, 10, 30)}
          />
        </div>
      </div>
    ),
  },
  {
    id: "primitives/datepicker-open",
    title: "DatePicker (open)",
    render: () => (
      <OverlayBox height={480}>
        {(c) => (
          <div className="p-4">
            <DatePicker
              label="Due"
              defaultValue={new CalendarDate(2026, 10, 30)}
              defaultOpen
              portalContainer={c}
              popoverProps={{
                isNonModal: true,
                shouldFlip: false,
                className: "max-h-none!",
              }}
            />
          </div>
        )}
      </OverlayBox>
    ),
  },
  {
    id: "primitives/datepicker-disabled",
    title: "DatePicker (disabled)",
    render: () => (
      <div className={box}>
        <DatePicker
          label="Due"
          isDisabled
          defaultValue={new CalendarDate(2026, 10, 30)}
        />
      </div>
    ),
  },
  {
    id: "primitives/datepicker-invalid",
    title: "DatePicker (invalid)",
    render: () => (
      <div className={box}>
        <DatePicker
          label="Due"
          isInvalid
          errorMessage="Due date can't be in the past"
          defaultValue={new CalendarDate(2020, 1, 1)}
        />
      </div>
    ),
  },
  {
    id: "primitives/timefield",
    title: "TimeField",
    render: () => (
      <div className={`${box} flex flex-col gap-4`}>
        <TimeField label="Starts (12h)" defaultValue={new Time(14, 30)} />
        <TimeField
          label="Starts (24h)"
          hourCycle={24}
          defaultValue={new Time(14, 30)}
        />
      </div>
    ),
  },
  {
    id: "primitives/timefield-focus",
    title: "TimeField (focus)",
    render: () => (
      <div className={box}>
        <div data-force-focus>
          <TimeField label="Starts" defaultValue={new Time(9, 5)} />
        </div>
      </div>
    ),
  },
  {
    id: "primitives/timefield-disabled",
    title: "TimeField (disabled)",
    render: () => (
      <div className={box}>
        <TimeField label="Starts" isDisabled defaultValue={new Time(9, 5)} />
      </div>
    ),
  },
  {
    id: "primitives/timefield-invalid",
    title: "TimeField (invalid)",
    render: () => (
      <div className={box}>
        <TimeField
          label="Starts"
          isInvalid
          errorMessage="Pick a time between 9 and 17"
          defaultValue={new Time(20, 0)}
        />
      </div>
    ),
  },
]);
