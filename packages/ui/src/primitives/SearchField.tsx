import {
  Button,
  Input,
  Label,
  SearchField as RACSearchField,
  type SearchFieldProps as RACSearchFieldProps,
} from "react-aria-components";
import { Kbd } from "../dusk/Kbd";
import { focusRing } from "./focus";

export type SearchFieldProps = Omit<
  RACSearchFieldProps,
  "className" | "children"
> & {
  label: string;
  placeholder?: string;
  /** Shortcut hint: a literal string such as "⌘K", or keys such as ["mod", "K"]. */
  shortcut?: string | string[];
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
          className={`min-h-11 w-full rounded-14 border border-white/14 bg-white/8 pl-4 pr-24 font-ui text-ink-primary placeholder:text-ink-muted disabled:cursor-not-allowed disabled:opacity-45 [&::-webkit-search-cancel-button]:hidden ${focusRing}`}
        />
        <div className="absolute right-0 flex items-center gap-1">
          <Button
            aria-label="Clear search"
            className={`hidden size-11 items-center justify-center rounded-full text-xs text-ink-secondary group-data-[empty]:hidden group-not-data-[empty]:flex ${focusRing}`}
          >
            ✕
          </Button>
          {shortcut ? (
            <Kbd keys={Array.isArray(shortcut) ? shortcut : [shortcut]} />
          ) : null}
        </div>
      </div>
    </RACSearchField>
  );
}
