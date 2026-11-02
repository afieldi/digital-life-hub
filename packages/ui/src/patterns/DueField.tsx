import type { Due } from "@dlh/core";
import {
  CalendarDate,
  parseAbsolute,
  parseDate,
  Time,
  toCalendarDate,
  toCalendarDateTime,
  toTime,
  toZoned,
} from "@internationalized/date";
import { X } from "lucide-react";
import { Button } from "../primitives/Button";
import { DatePicker } from "../primitives/DatePicker";
import { TimeField } from "../primitives/TimeField";

export type DueFieldProps = {
  label: string;
  value: Due | null;
  onChange: (value: Due | null) => void;
  /** IANA zone a chosen time is set in. */
  timeZone: string;
  className?: string;
};

function split(
  value: Due | null,
  timeZone: string,
): { date: CalendarDate | null; time: Time | null } {
  if (!value) return { date: null, time: null };
  if ("date" in value) return { date: parseDate(value.date), time: null };
  const z = parseAbsolute(value.dateTime, value.timeZone ?? timeZone);
  return { date: toCalendarDate(z), time: toTime(z) };
}

function join(date: CalendarDate, time: Time, timeZone: string): Due {
  const zoned = toZoned(toCalendarDateTime(date, time), timeZone);
  // ZonedDateTime#toString ends with "[zone]"; the stored string is the ISO with offset.
  return { dateTime: zoned.toString().replace(/\[.*\]$/, ""), timeZone };
}

/** A date, plus an optional time of day set in `timeZone`. */
export function DueField({
  label,
  value,
  onChange,
  timeZone,
  className,
}: DueFieldProps) {
  const { date, time } = split(value, timeZone);
  return (
    <div className={`flex flex-wrap items-end gap-3 ${className ?? ""}`}>
      <DatePicker
        label={label}
        className="min-w-0 flex-1"
        value={date}
        onChange={(d) => {
          if (!d) return onChange(null);
          const next = new CalendarDate(d.year, d.month, d.day);
          onChange(
            time ? join(next, time, timeZone) : { date: next.toString() },
          );
        }}
      />
      <TimeField
        label={`${label} time`}
        hourCycle={24}
        className="w-36"
        isDisabled={!date}
        value={time}
        onChange={(t) => {
          if (!date) return;
          onChange(
            t
              ? join(date, new Time(t.hour, t.minute), timeZone)
              : { date: date.toString() },
          );
        }}
      />
      {time ? (
        <Button
          variant="icon"
          aria-label={`Clear ${label} time`}
          onPress={() => date && onChange({ date: date.toString() })}
        >
          <X aria-hidden="true" size={16} />
        </Button>
      ) : null}
    </div>
  );
}
