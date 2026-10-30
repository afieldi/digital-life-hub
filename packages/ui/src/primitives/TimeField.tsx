import type { TimeValue } from "react-aria-components";
import {
  DateInput,
  DateSegment,
  FieldError,
  Label,
  TimeField as RACTimeField,
  type TimeFieldProps as RACTimeFieldProps,
  Text,
} from "react-aria-components";

export const dateInputClass =
  "flex min-h-11 w-full items-center rounded-14 border border-white/14 bg-white/8 px-4 font-ui text-ink-primary invalid:border-type-event focus-within:outline-2 focus-within:outline-solid focus-within:outline-offset-2 focus-within:outline-link data-[disabled]:cursor-not-allowed data-[disabled]:opacity-45";
export const dateSegmentClass =
  "rounded-10 px-0.5 tabular-nums caret-transparent outline-hidden data-[placeholder]:text-ink-muted focus:bg-link focus:text-app data-[type=literal]:px-0";

export type TimeFieldProps<T extends TimeValue = TimeValue> = Omit<
  RACTimeFieldProps<T>,
  "className" | "children" | "hourCycle"
> & {
  label: string;
  description?: string;
  errorMessage?: string;
  className?: string;
  hourCycle?: 12 | 24;
};

export function TimeField<T extends TimeValue = TimeValue>({
  label,
  description,
  errorMessage,
  className,
  hourCycle,
  ...props
}: TimeFieldProps<T>) {
  return (
    <RACTimeField
      {...props}
      hourCycle={hourCycle}
      className={`flex flex-col gap-1.5${className ? ` ${className}` : ""}`}
    >
      <Label className="font-ui text-sm text-ink-secondary">{label}</Label>
      <DateInput className={dateInputClass}>
        {(segment) => (
          <DateSegment segment={segment} className={dateSegmentClass} />
        )}
      </DateInput>
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
    </RACTimeField>
  );
}
