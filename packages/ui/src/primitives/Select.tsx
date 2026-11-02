import {
  Label,
  ListBox,
  ListBoxItem,
  Button as RACButton,
  Select as RACSelect,
  SelectValue,
} from "react-aria-components";
import { inputClass } from "../internal/classes";
import { Popover } from "./Popover";

export type SelectProps<T extends string> = {
  label: string;
  options: { id: T; label: string }[];
  value: T | null;
  onChange: (value: T | null) => void;
  placeholder?: string;
  className?: string;
};

export function Select<T extends string>({
  label,
  options,
  value,
  onChange,
  placeholder = "Select…",
  className,
}: SelectProps<T>) {
  return (
    <RACSelect
      selectedKey={value}
      onSelectionChange={(key) => onChange(key === null ? null : (key as T))}
      placeholder={placeholder}
      className={`flex flex-col gap-1.5 ${className ?? ""}`}
    >
      <Label className="font-ui text-sm text-ink-secondary">{label}</Label>
      <RACButton
        className={`${inputClass} flex cursor-pointer items-center justify-between gap-2 text-left`}
      >
        <SelectValue className="data-[placeholder]:text-ink-muted" />
        <svg
          aria-hidden="true"
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M2 4.5 6 8.5 10 4.5" />
        </svg>
      </RACButton>
      <Popover className="w-(--trigger-width) p-1.5">
        <ListBox className="flex max-h-72 flex-col gap-0.5 overflow-auto outline-hidden">
          {options.map((o) => (
            <ListBoxItem
              key={o.id}
              id={o.id}
              textValue={o.label}
              className="flex min-h-11 cursor-pointer items-center gap-2 rounded-10 px-3 font-ui text-sm text-ink-primary outline-hidden focused:bg-white/15 pressed:bg-white/20 selected:font-semibold focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-link"
            >
              {o.label}
            </ListBoxItem>
          ))}
        </ListBox>
      </Popover>
    </RACSelect>
  );
}
