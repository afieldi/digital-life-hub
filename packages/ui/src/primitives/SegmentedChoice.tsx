import { Label, ToggleButton, ToggleButtonGroup } from "react-aria-components";
import { focusRing } from "./focus";

export type SegmentedChoiceProps<T extends string> = {
  label: string;
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
  /** Lets the selected option be pressed again to clear the choice. */
  allowEmpty?: boolean;
  className?: string;
};

export function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  allowEmpty = false,
  className,
}: SegmentedChoiceProps<T>) {
  return (
    <div className={`flex flex-col gap-1.5 ${className ?? ""}`}>
      <Label className="font-ui text-sm text-ink-secondary" id={`seg-${label}`}>
        {label}
      </Label>
      <ToggleButtonGroup
        aria-labelledby={`seg-${label}`}
        selectionMode="single"
        disallowEmptySelection={!allowEmpty}
        selectedKeys={value === null ? [] : [value]}
        onSelectionChange={(keys) => {
          const [first] = keys;
          onChange(first === undefined ? null : (String(first) as T));
        }}
        className="inline-flex gap-1 rounded-14 border border-white/14 bg-white/8 p-1"
      >
        {options.map((o) => (
          <ToggleButton
            key={o.id}
            id={o.id}
            className={`min-h-9 flex-1 cursor-pointer rounded-10 px-4 font-ui text-sm text-ink-secondary hovered:bg-white/10 selected:bg-link selected:font-semibold selected:text-app ${focusRing}`}
          >
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}
