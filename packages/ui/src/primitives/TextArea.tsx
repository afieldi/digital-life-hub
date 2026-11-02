import {
  Label,
  TextArea as RACTextArea,
  TextField as RACTextField,
} from "react-aria-components";
import { inputClass } from "../internal/classes";

export type TextAreaProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  placeholder?: string;
  className?: string;
};

export function TextArea({
  label,
  value,
  onChange,
  rows = 4,
  placeholder,
  className,
}: TextAreaProps) {
  return (
    <RACTextField
      value={value}
      onChange={onChange}
      className={`flex flex-col gap-1.5 ${className ?? ""}`}
    >
      <Label className="font-ui text-sm text-ink-secondary">{label}</Label>
      <RACTextArea
        rows={rows}
        placeholder={placeholder}
        className={`${inputClass} resize-y py-3`}
      />
    </RACTextField>
  );
}
