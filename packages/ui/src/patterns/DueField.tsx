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
  type ZonedDateTime,
} from "@internationalized/date";
import { X } from "lucide-react";
import { Button } from "../primitives/Button";
import { DatePicker } from "../primitives/DatePicker";
import { TimeField } from "../primitives/TimeField";

export type DueFieldProps = {
  label: string;
  value: Due | null;
  onChange: (value: Due | null) => void;
  /**
   * IANA zone the field shows and edits in (the device's). A time set in
   * another zone shows here as this zone's time; a date change alone keeps
   * the zone it was set in, a new time is set in this one.
   */
  timeZone: string;
  className?: string;
};

function split(
  value: Due | null,
  timeZone: string,
): { date: CalendarDate | null; time: Time | null } {
  if (!value) return { date: null, time: null };
  if ("date" in value) return { date: parseDate(value.date), time: null };
  const z = parseAbsolute(value.dateTime, timeZone);
  return { date: toCalendarDate(z), time: toTime(z) };
}

/** ZonedDateTime#toString ends with "[zone]"; the stored string is the ISO with offset. */
function stored(zoned: ZonedDateTime, timeZone: string): Due {
  return { dateTime: zoned.toString().replace(/\[.*\]$/, ""), timeZone };
}

function join(date: CalendarDate, time: Time, timeZone: string): Due {
  return stored(toZoned(toCalendarDateTime(date, time), timeZone), timeZone);
}

/**
 * `value` (timed) moved by as many days as the shown date moved, at the same
 * wall time in the zone it was set in.
 */
function moveDays(
  value: Extract<Due, { dateTime: string }>,
  from: CalendarDate,
  to: CalendarDate,
  timeZone: string,
): Due {
  const zone = value.timeZone ?? timeZone;
  const moved = parseAbsolute(value.dateTime, zone).add({
    days: to.compare(from),
  });
  return stored(moved, zone);
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
          if (!time || !date || !value || "date" in value) {
            onChange(
              time ? join(next, time, timeZone) : { date: next.toString() },
            );
          } else {
            onChange(moveDays(value, date, next, timeZone));
          }
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
