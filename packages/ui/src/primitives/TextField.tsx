import {
  FieldError,
  Input,
  Label,
  TextField as RACTextField,
  type TextFieldProps as RACTextFieldProps,
  Text,
} from "react-aria-components";
import { inputClass } from "../internal/classes";

export type TextFieldProps = Omit<
  RACTextFieldProps,
  "className" | "children"
> & {
  label: string;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  className?: string;
};

export function TextField({
  label,
  description,
  errorMessage,
  placeholder,
  className,
  ...props
}: TextFieldProps) {
  return (
    <RACTextField
      {...props}
      className={`flex flex-col gap-1.5 ${className ?? ""}`}
    >
      <Label className="font-ui text-sm text-ink-secondary">{label}</Label>
      <Input className={inputClass} placeholder={placeholder} />
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
    </RACTextField>
  );
}
