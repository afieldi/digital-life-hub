import { z } from "zod";
import { dueValue } from "./due";

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

type FieldTag = "due" | "item" | "longText";
type FieldMeta = { dlhField?: FieldTag; types?: string[] };

/** Schemas for form fields that a plain Zod type can't express. */
export const fields = {
  /** A date picker with an optional time (`Due`). */
  due: () => dueValue.meta({ dlhField: "due" }),
  /** An item id, picked by searching items of these types. */
  item: (types: string[]) => z.uuid().meta({ dlhField: "item", types }),
  /** Plain text shown as a text area. */
  longText: () => z.string().meta({ dlhField: "longText" }),
};

export type FieldSpec = {
  name: string;
  label: string;
  kind: "text" | "longText" | "choice" | "switch" | "due" | "item";
  optional: boolean;
  options?: string[];
  types?: string[];
};

/**
 * The fields of the ⌘K form generated from `schema`, one per key except
 * `omit`. Throws on any schema the form can't render, so a form never shows
 * half-built.
 */
export function formFields(
  schema: z.ZodObject,
  omit: string[] = [],
): FieldSpec[] {
  return Object.entries(schema.shape)
    .filter(([name]) => !omit.includes(name))
    .map(([name, field]) => fieldSpec(name, field as z.ZodType));
}

function fieldSpec(name: string, outer: z.ZodType): FieldSpec {
  // Read kinds from `def.type`: string formats such as `z.uuid()` have type
  // "string" but are not all `instanceof z.ZodString`.
  const optional = outer.def.type === "optional";
  const inner = optional ? (outer as z.ZodOptional<z.ZodType>).unwrap() : outer;
  const label = outer.description ?? inner.description ?? name;
  const base = { name, label, optional };
  const meta = (inner.meta() ?? {}) as FieldMeta;

  if (meta.dlhField === "item") {
    return { ...base, kind: "item", types: meta.types ?? [] };
  }
  if (meta.dlhField) return { ...base, kind: meta.dlhField };
  switch (inner.def.type) {
    case "enum":
      return {
        ...base,
        kind: "choice",
        options: (inner as z.ZodEnum).options.map(String),
      };
    case "string":
      return { ...base, kind: "text" };
    case "boolean":
      return { ...base, kind: "switch" };
    default:
      throw new OperationError(
        `Field "${name}" has a schema (${inner.def.type}) that forms can't render`,
      );
  }
}
