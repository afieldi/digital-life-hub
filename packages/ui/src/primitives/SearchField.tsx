import {
  Button,
  Input,
  Label,
  SearchField as RACSearchField,
  type SearchFieldProps as RACSearchFieldProps,
} from "react-aria-components";
import { focusRing } from "./focus";

export type SearchFieldProps = Omit<
  RACSearchFieldProps,
  "className" | "children"
> & {
  label: string;
  placeholder?: string;
  /** Shortcut hint, e.g. "⌘K". Rendered as plain text until Kbd lands. */
  shortcut?: string;
  className?: string;
};

export function SearchField({
  label,
  placeholder,
  shortcut,
  className,
  ...props
}: SearchFieldProps) {
  return (
    <RACSearchField
      {...props}
      className={`group flex flex-col gap-1.5${className ? ` ${className}` : ""}`}
    >
      <Label className="sr-only">{label}</Label>
      <div className="relative flex items-center">
        <Input
          placeholder={placeholder}
          className={`min-h-11 w-full rounded-14 border border-white/14 bg-white/8 pl-4 pr-20 font-ui text-ink-primary placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-45 [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
        />
        <div className="absolute right-2 flex items-center gap-1">
          <Button
            aria-label="Clear search"
            className={`hidden size-8 items-center justify-center rounded-full text-ink-secondary group-data-[empty]:hidden group-not-data-[empty]:flex ${focusRing}`}
          >
            ✕
          </Button>
          {shortcut ? (
            <span className="font-ui text-xs text-ink-tertiary">
              {shortcut}
            </span>
          ) : null}
        </div>
      </div>
    </RACSearchField>
  );
}
