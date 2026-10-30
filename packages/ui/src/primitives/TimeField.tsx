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
import { dateInputClass, dateSegmentClass } from "../internal/classes";

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
      className={`flex flex-col gap-1.5 ${className ?? ""}`}
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
