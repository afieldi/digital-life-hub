import {
  type FieldSpec,
  formFields,
  ITEM_KEYS,
  type OperationDescription,
  type PaletteContext,
} from "@dlh/core";
import type { CommandItem } from "@dlh/ui";

/** How ⌘K can get an operation's input from what is on screen and typed. */
export type OperationPlan =
  | { status: "ready"; input: unknown }
  /** A form asks for the rest; `toInput` turns its values into the input. */
  | {
      status: "form";
      fields: FieldSpec[];
      initial: Record<string, unknown>;
      toInput: (values: Record<string, unknown>) => unknown;
    }
  /** Not buildable yet, and no form to ask with: only AI can take it from here. */
  | { status: "waiting" };

export type OperationGroupId = "create" | "actions";

/** Whether `op` is offered for the item on screen (`null` for none). */
export function appliesTo(
  op: OperationDescription,
  itemType: string | null,
): boolean {
  const scopes: string[] = Array.isArray(op.appliesTo)
    ? op.appliesTo
    : [op.appliesTo];
  return itemType === null
    ? scopes.includes("none")
    : scopes.includes("*") || scopes.includes(itemType);
}

/**
 * The text typed after the operation's name: the query starts with its label
 * or one of its `words` (any case), or is the start of its label (text "").
 * `null` when the query names something else.
 */
export function operationText(
  op: OperationDescription,
  query: string,
): string | null {
  const q = query.trimStart();
  const lower = q.toLowerCase();
  // "Make subtask of…" is matched without its ellipsis.
  const label = op.label.replace(/(…|\.\.\.)$/, "").toLowerCase();
  const names = [label, ...(op.words ?? []).map((w) => w.toLowerCase())].sort(
    (a, b) => b.length - a.length,
  );
  for (const name of names) {
    if (lower === name || lower.startsWith(`${name} `)) {
      return q.slice(name.length).trim();
    }
  }
  return label.startsWith(lower.trimEnd()) ? "" : null;
}

/** Drops keys whose value is `undefined`, so a schema sees them as missing. */
function defined(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).filter(([, v]) => v !== undefined),
  );
}

/** Builders can throw on a context they don't expect (e.g. no item on screen). */
function attempt<T>(build: () => T): T | null {
  try {
    return build();
  } catch {
    return null;
  }
}

/** How `op`'s `palette` spec builds its input from `ctx` (see the ⌘K table in the spec). */
export function planOperation(
  op: OperationDescription,
  ctx: PaletteContext,
): OperationPlan {
  const spec = op.palette ?? true;
  if (spec === false) return { status: "waiting" };
  if (spec === true) {
    // `id` and `expectedUpdatedAt` come from the item on screen; any other key is the form.
    const shape = op.input.shape;
    const fromItem = defined({
      id: "id" in shape ? ctx.item?.id : undefined,
      expectedUpdatedAt:
        "expectedUpdatedAt" in shape ? ctx.item?.updatedAt : undefined,
    });
    const fields = formFields(op.input, [...ITEM_KEYS]);
    if (fields.length === 0) {
      const parsed = op.input.safeParse(fromItem);
      return parsed.success
        ? { status: "ready", input: parsed.data }
        : { status: "waiting" };
    }
    return {
      status: "form",
      fields,
      initial: {},
      toInput: (values) => ({ ...fromItem, ...values }),
    };
  }
  if (typeof spec === "function") {
    const input = attempt(() => spec(ctx));
    return input === null ? { status: "waiting" } : { status: "ready", input };
  }
  const initial = defined(spec.prefill?.(ctx) ?? {});
  const parsed = spec.params.safeParse(initial);
  if (parsed.success) {
    const input = attempt(() => spec.toInput(ctx, parsed.data));
    if (input !== null) return { status: "ready", input };
  }
  return {
    status: "form",
    fields: formFields(spec.params),
    initial,
    toInput: (values) => spec.toInput(ctx, values),
  };
}

/** What a row that isn't ready still needs, for the first such field ⌘K has copy for. */
export function missingHint(plan: OperationPlan): string | undefined {
  if (plan.status !== "form") return undefined;
  const missing = plan.fields.find(
    (f) =>
      !f.optional &&
      [undefined, null, ""].includes(plan.initial[f.name] as never),
  );
  if (missing?.kind === "due") return "Type a date";
  if (missing?.name === "title") return "Add a title";
  return undefined;
}

/** The row's label: the summary of a ready input, else the operation's name. */
export function rowLabel(
  op: OperationDescription,
  plan: OperationPlan,
): string {
  if (plan.status !== "ready") return op.label;
  return attempt(() => op.summary(plan.input as never)) ?? op.label;
}

/** The row for `op` given its plan; it stays open so choosing can enter the step. */
export function operationRow(
  op: OperationDescription,
  plan: OperationPlan,
  onAction: () => void,
  opts: { disabled?: boolean } = {},
): CommandItem {
  return {
    id: `op:${op.id}`,
    label: rowLabel(op, plan),
    hint: missingHint(plan),
    keepOpen: true,
    ...(opts.disabled ? { disabled: true } : {}),
    onAction,
  };
}

/**
 * ⌘K rows for the operations that apply to the item on screen and that the
 * query names, by group. Choosing one passes its context, with `text` set to
 * what was typed after its name.
 */
export function operationRows(
  ops: readonly OperationDescription[],
  ctx: Omit<PaletteContext, "text">,
  query: string,
  onChoose: (op: OperationDescription, ctx: PaletteContext) => void,
): Record<OperationGroupId, CommandItem[]> {
  const rows: Record<OperationGroupId, CommandItem[]> = {
    create: [],
    actions: [],
  };
  const itemType = ctx.item?.type ?? null;
  for (const op of ops) {
    if (op.palette === false || !appliesTo(op, itemType)) continue;
    const text = operationText(op, query);
    if (text === null) continue;
    const full = { ...ctx, text };
    const plan = planOperation(op, full);
    rows[op.group ?? "actions"].push(
      operationRow(op, plan, () => onChoose(op, full)),
    );
  }
  return rows;
}
