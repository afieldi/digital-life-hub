import type { ReactNode } from "react";
import {
  FieldError,
  Input,
  Label,
  ListBox,
  ListBoxItem,
  type ListBoxItemProps,
  ComboBox as RACComboBox,
  type ComboBoxProps as RACComboBoxProps,
  Text,
} from "react-aria-components";
import { Button } from "./Button";
import { Popover, type PopoverProps } from "./Popover";
import { inputClass } from "./TextField";

export type ComboBoxProps<T extends object> = Omit<
  RACComboBoxProps<T>,
  "className" | "children" | "items" | "defaultItems"
> & {
  /** Filtered by the typed text (matched against each item's text). */
  items?: Iterable<T>;
  label: string;
  description?: string;
  errorMessage?: string;
  placeholder?: string;
  className?: string;
  children: ReactNode | ((item: T) => ReactNode);
  portalContainer?: Element | null;
  /** Extra Popover props (placement, isNonModal…), for the gallery. */
  popoverProps?: Omit<PopoverProps, "children">;
};

export function ComboBox<T extends object>({
  label,
  description,
  errorMessage,
  placeholder,
  className,
  children,
  portalContainer,
  popoverProps,
  items,
  ...props
}: ComboBoxProps<T>) {
  return (
    <RACComboBox
      {...props}
      defaultItems={items}
      className={`flex flex-col gap-1.5${className ? ` ${className}` : ""}`}
    >
      <Label className="font-ui text-sm text-ink-secondary">{label}</Label>
      <div className="relative flex items-center">
        <Input className={`${inputClass} pr-12`} placeholder={placeholder} />
        <Button
          variant="icon"
          aria-label={`Show ${label} options`}
          className="absolute right-0"
        >
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
        </Button>
      </div>
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
        className={`w-(--trigger-width) p-1.5${popoverProps?.className ? ` ${popoverProps.className}` : ""}`}
      >
        <ListBox className="flex max-h-72 flex-col gap-0.5 overflow-auto outline-hidden">
          {children}
        </ListBox>
      </Popover>
    </RACComboBox>
  );
}

export type ComboBoxItemProps = Omit<ListBoxItemProps, "className"> & {
  className?: string;
};

export function ComboBoxItem({ className, ...props }: ComboBoxItemProps) {
  return (
    <ListBoxItem
      textValue={
        typeof props.children === "string" ? props.children : undefined
      }
      {...props}
      className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-10 px-3 font-ui text-sm text-ink-primary outline-hidden focused:bg-white/15 pressed:bg-white/20 selected:font-semibold focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-link disabled:cursor-not-allowed disabled:opacity-45${className ? ` ${className}` : ""}`}
    />
  );
}
