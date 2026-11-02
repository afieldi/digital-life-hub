import type { ItemSummary } from "@dlh/core";
import { useEffect, useRef, useState } from "react";
import { ComboBox, ComboBoxItem } from "../primitives/ComboBox";

export type ItemSearchFieldProps = {
  label: string;
  /** Item types that may be picked (shown as a hint); `search` does the filtering. */
  types?: string[];
  search: (query: string) => Promise<ItemSummary[]>;
  value: ItemSummary | null;
  onChange: (value: ItemSummary | null) => void;
  className?: string;
};

/** A combo box that searches items as you type and picks one. */
export function ItemSearchField({
  label,
  types,
  search,
  value,
  onChange,
  className,
}: ItemSearchFieldProps) {
  const [text, setText] = useState(value?.title ?? "");
  const [results, setResults] = useState<ItemSummary[]>(value ? [value] : []);
  const latest = useRef(0);
  const run = (q: string) => {
    const mine = ++latest.current;
    search(q).then(
      (rows) => {
        if (mine === latest.current) setResults(rows);
      },
      () => {
        if (mine === latest.current) setResults([]);
      },
    );
  };
  // Load the first page up front so the list is ready when the field is focused.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, on mount
  useEffect(() => run(text), []);
  return (
    <ComboBox
      label={label}
      className={className}
      items={results}
      defaultFilter={() => true}
      menuTrigger="focus"
      placeholder={
        types?.length ? `Find ${types.join(" or ")}` : "Find an item"
      }
      inputValue={text}
      selectedKey={value?.id ?? null}
      onInputChange={(q) => {
        setText(q);
        if (q === "" && value) onChange(null);
        run(q);
      }}
      onSelectionChange={(key) => {
        const picked = results.find((r) => r.id === key) ?? null;
        if (picked) {
          setText(picked.title);
          onChange(picked);
        } else if (key === null) {
          onChange(null);
        }
      }}
    >
      {(row: ItemSummary) => (
        <ComboBoxItem id={row.id} textValue={row.title}>
          <span className="truncate">{row.title}</span>
          <span className="ml-auto text-xs text-ink-tertiary">{row.type}</span>
        </ComboBoxItem>
      )}
    </ComboBox>
  );
}
