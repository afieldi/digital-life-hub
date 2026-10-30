import type { DateValue } from "react-aria-components";
import {
  Calendar,
  CalendarCell,
  CalendarGrid,
  DateInput,
  DateSegment,
  FieldError,
  Group,
  Heading,
  Label,
  DatePicker as RACDatePicker,
  type DatePickerProps as RACDatePickerProps,
  Text,
} from "react-aria-components";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Popover, type PopoverProps } from "./Popover";
import { dateInputClass, dateSegmentClass } from "./TimeField";

export type DatePickerProps<T extends DateValue = DateValue> = Omit<
  RACDatePickerProps<T>,
  "className" | "children"
> & {
  label: string;
  description?: string;
  errorMessage?: string;
  className?: string;
  portalContainer?: Element | null;
  /** Extra Popover props (placement, isNonModal…), for the gallery. */
  popoverProps?: Omit<PopoverProps, "children">;
};

const chevron = (d: string) => (
  <svg
    aria-hidden="true"
    width="12"
    height="12"
    viewBox="0 0 12 12"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
  >
    <path d={d} />
  </svg>
);

export function DatePicker<T extends DateValue = DateValue>({
  label,
  description,
  errorMessage,
  className,
  portalContainer,
  popoverProps,
  ...props
}: DatePickerProps<T>) {
  return (
    <RACDatePicker
      {...props}
      className={`flex flex-col gap-1.5 ${className ?? ""}`}
    >
      <Label className="font-ui text-sm text-ink-secondary">{label}</Label>
      <Group className="relative flex items-center">
        <DateInput className={`${dateInputClass} pr-12`}>
          {(segment) => (
            <DateSegment segment={segment} className={dateSegmentClass} />
          )}
        </DateInput>
        <Button
          variant="icon"
          aria-label={`Open ${label} calendar`}
          className="absolute right-0"
        >
          <svg
            aria-hidden="true"
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
          >
            <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
            <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
          </svg>
        </Button>
      </Group>
      {description ? (
        <Text slot="description" className="font-ui text-xs text-ink-tertiary">
          {description}
        </Text>
      ) : null}
      {errorMessage ? (
        <FieldError className="font-ui text-xs text-type-event">
          {errorMessage}
        </FieldError>
      ) : null}
      <Popover
        {...popoverProps}
        portalContainer={portalContainer}
        className={popoverProps?.className}
      >
        <Dialog aria-label={`${label} calendar`} className="p-3">
          <Calendar className="flex flex-col gap-2 font-ui text-ink-primary">
            <header className="flex items-center justify-between">
              <Button
                variant="icon"
                slot="previous"
                aria-label="Previous month"
              >
                {chevron("M7.5 2 3.5 6l4 4")}
              </Button>
              <Heading className="font-ui text-sm font-semibold" />
              <Button variant="icon" slot="next" aria-label="Next month">
                {chevron("M4.5 2l4 4-4 4")}
              </Button>
            </header>
            <CalendarGrid className="border-separate border-spacing-0.5">
              {(date) => (
                <CalendarCell
                  date={date}
                  className="flex size-11 cursor-pointer items-center justify-center rounded-full text-sm tabular-nums outline-hidden hovered:bg-white/15 selected:bg-link selected:font-semibold selected:text-app data-[outside-month]:hidden data-[today]:ring-1 data-[today]:ring-white/40 data-[disabled]:opacity-45 data-[unavailable]:line-through focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-link"
                />
              )}
            </CalendarGrid>
          </Calendar>
        </Dialog>
      </Popover>
    </RACDatePicker>
  );
}
