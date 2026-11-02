import type { FieldSpec, ItemSummary } from "@dlh/core";
import { useEffect, useRef, useState } from "react";
import { Button } from "../primitives/Button";
import { Dialog, Modal } from "../primitives/Dialog";
import { SegmentedChoice } from "../primitives/SegmentedChoice";
import { Select } from "../primitives/Select";
import { Switch } from "../primitives/Switch";
import { TextArea } from "../primitives/TextArea";
import { TextField } from "../primitives/TextField";
import { DueField } from "./DueField";
import { ItemSearchField } from "./ItemSearchField";

export type OperationFormProps = {
  title: string;
  fields: FieldSpec[];
  /** Starting values by field name; an item field is an ItemSummary (or just its id, shown empty). */
  initial: Record<string, unknown>;
  timeZone: string;
  search: (query: string, types: string[]) => Promise<ItemSummary[]>;
  onSubmit: (values: Record<string, unknown>) => void;
  onCancel: () => void;
  /** @internal gallery only: backdrop covers its portal container. */
  contained?: boolean;
};

type Values = Record<string, unknown>;

function isEmpty(f: FieldSpec, v: unknown): boolean {
  if (f.kind === "switch") return false;
  if (typeof v === "string") return v.trim() === "";
  return v === undefined || v === null;
}

function seed(fields: FieldSpec[], initial: Values): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = initial[f.name];
    if (v === undefined || v === null) continue;
    // A bare id has no title to show: the field stays empty until another item is picked.
    out[f.name] =
      f.kind === "item" && typeof v === "string"
        ? ({
            id: v,
            type: "",
            title: "",
            archivedAt: null,
          } satisfies ItemSummary)
        : v;
  }
  return out;
}

/**
 * `null` only for a nullable field that had a value (initially or set here) and
 * was cleared; a field never given a value is left out.
 */
function output(
  fields: FieldSpec[],
  values: Values,
  hadValue: Set<string>,
): Values {
  const out: Values = {};
  for (const f of fields) {
    const v = values[f.name];
    if (f.kind === "switch") {
      if (v !== undefined || !f.optional) out[f.name] = v === true;
    } else if (isEmpty(f, v)) {
      if (f.nullable && hadValue.has(f.name)) out[f.name] = null;
    } else {
      out[f.name] = f.kind === "item" ? (v as ItemSummary).id : v;
    }
  }
  return out;
}

export function OperationForm({
  title,
  fields,
  initial,
  timeZone,
  search,
  onSubmit,
  onCancel,
  contained,
}: OperationFormProps) {
  const [values, setValues] = useState<Values>(() => seed(fields, initial));
  const [hadValue] = useState(() => new Set(Object.keys(values)));
  const set = (name: string, v: unknown) => {
    const f = fields.find((x) => x.name === name);
    if (f && !isEmpty(f, v)) hadValue.add(name);
    setValues((prev) => ({ ...prev, [name]: v }));
  };
  const ready = fields.every((f) => f.optional || !isEmpty(f, values[f.name]));
  return (
    <Modal
      isOpen
      onOpenChange={(open) => !open && onCancel()}
      contained={contained}
    >
      <Dialog title={title}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) onSubmit(output(fields, values, hadValue));
          }}
        >
          <FocusFirstMissing fields={fields} initial={values}>
            {fields.map((f) => (
              <div key={f.name} data-field={f.name}>
                {renderField(f, values[f.name], (v) => set(f.name, v), {
                  timeZone,
                  search,
                })}
              </div>
            ))}
          </FocusFirstMissing>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onPress={onCancel}>
              Cancel
            </Button>
            <Button variant="solid" type="submit" isDisabled={!ready}>
              Run
            </Button>
          </div>
        </form>
      </Dialog>
    </Modal>
  );
}

/** On open, moves focus into the first required field still missing (else the first field). */
function FocusFirstMissing({
  fields,
  initial,
  children,
}: {
  fields: FieldSpec[];
  initial: Values;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef({ fields, initial });
  useEffect(() => {
    const { fields: fs, initial: vals } = start.current;
    const target =
      fs.find((f) => !f.optional && isEmpty(f, vals[f.name])) ?? fs[0];
    if (!target) return;
    const id = requestAnimationFrame(() => {
      const wrap = [
        ...(ref.current?.querySelectorAll("[data-field]") ?? []),
      ].find((el) => el.getAttribute("data-field") === target.name);
      wrap
        ?.querySelector<HTMLElement>(
          'input:not([type="hidden"]), textarea, button, [role="spinbutton"]',
        )
        ?.focus();
    });
    return () => cancelAnimationFrame(id);
  }, []);
  return (
    <div ref={ref} className="flex flex-col gap-4">
      {children}
    </div>
  );
}

function renderField(
  f: FieldSpec,
  value: unknown,
  onChange: (v: unknown) => void,
  ctx: { timeZone: string; search: OperationFormProps["search"] },
) {
  switch (f.kind) {
    case "text":
      return (
        <TextField
          label={f.label}
          value={(value as string | undefined) ?? ""}
          onChange={onChange}
        />
      );
    case "longText":
      return (
        <TextArea
          label={f.label}
          value={(value as string | undefined) ?? ""}
          onChange={onChange}
        />
      );
    case "choice": {
      const options = (f.options ?? []).map((o) => ({ id: o, label: o }));
      const v = (value as string | undefined) ?? null;
      return options.length <= 4 ? (
        <SegmentedChoice
          label={f.label}
          options={options}
          value={v}
          onChange={onChange}
          allowEmpty={f.optional || f.nullable}
        />
      ) : (
        <Select
          label={f.label}
          options={options}
          value={v}
          onChange={onChange}
        />
      );
    }
    case "switch":
      return (
        <Switch isSelected={value === true} onChange={onChange}>
          {f.label}
        </Switch>
      );
    case "due":
      return (
        <DueField
          label={f.label}
          value={(value as never) ?? null}
          onChange={onChange}
          timeZone={ctx.timeZone}
        />
      );
    case "item":
      return (
        <ItemSearchField
          label={f.label}
          types={f.types}
          search={ctx.search}
          value={(value as ItemSummary | undefined) ?? null}
          onChange={onChange}
        />
      );
  }
}
