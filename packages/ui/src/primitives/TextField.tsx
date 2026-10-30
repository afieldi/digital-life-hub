import {
  FieldError,
  Input,
  Label,
  TextField as RACTextField,
  type TextFieldProps as RACTextFieldProps,
  Text,
} from "react-aria-components";
import { focusRing } from "./focus";

export const inputClass = `min-h-11 w-full rounded-14 border border-white/14 bg-white/8 px-4 font-ui text-ink-primary placeholder:text-ink-muted invalid:border-type-event disabled:cursor-not-allowed disabled:opacity-45 ${focusRing}`;

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
