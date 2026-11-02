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
  /** `label` names the row when the input came with item titles to show. */
  | { status: "ready"; input: unknown; label?: string }
  /** A form asks for the rest; `toInput` turns its values into the input. */
  | {
      status: "form";
      fields: FieldSpec[];
      initial: Record<string, unknown>;
      toInput: (values: Record<string, unknown>) => unknown;
    }
  /** Not buildable yet, and no form to ask with: only AI can take it from here. */
  | { status: "waiting"; hint?: string };

export type OperationGroupId = "create" | "actions";

/**
 * What a palette form's `load` read for the item on screen: its `values`, and
 * the titles of the item fields among them, so a ready row can name them.
 */
export type Loaded = {
  values: Record<string, unknown>;
  titles: Record<string, string>;
};

/** Whether ⌘K must run `op`'s palette `load` before planning it with this context. */
export function needsLoad(
  op: OperationDescription,
  ctx: Omit<PaletteContext, "text">,
): boolean {
  return (
    typeof op.palette === "object" &&
    op.palette.load !== undefined &&
    ctx.item !== undefined
  );
}

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

/** How the query named an operation: by its label, or only by one of its `words`. */
export type OperationMatch = { text: string; by: "label" | "word" };

/**
 * The text typed after the operation's name: the query starts with its label
 * or one of its `words` (any case, longest name first), or is the start of its
 * label (text ""). `null` when the query names something else.
 */
export function operationText(
  op: OperationDescription,
  query: string,
): OperationMatch | null {
  const q = query.trimStart();
  const lower = q.toLowerCase();
  // "Make subtask of…" is matched without its ellipsis.
  const label = op.label.replace(/(…|\.\.\.)$/, "").toLowerCase();
  const starts = (name: string) =>
    lower === name || lower.startsWith(`${name} `);
  const byLabel = starts(label) || label.startsWith(lower.trimEnd());
  const names = [label, ...(op.words ?? []).map((w) => w.toLowerCase())].sort(
    (a, b) => b.length - a.length,
  );
  const name = names.find(starts);
  if (name !== undefined) {
    return {
      text: q.slice(name.length).trim(),
      by: byLabel ? "label" : "word",
    };
  }
  return byLabel ? { text: "", by: "label" } : null;
}

/**
 * Whether ⌘K builds `op`'s input from the item on screen alone (palette `true`
 * with no form fields left), so typed text has nowhere to go.
 */
export function consumesNoText(op: OperationDescription): boolean {
  if (op.palette !== undefined && op.palette !== true) return false;
  return attempt(() => formFields(op.input, [...ITEM_KEYS]))?.length === 0;
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
  loaded?: Loaded,
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
    return input === null
      ? { status: "waiting", hint: waitingHint(op) }
      : { status: "ready", input };
  }
  const initial = {
    ...defined(loaded?.values ?? {}),
    ...defined(spec.prefill?.(ctx) ?? {}),
  };
  const parsed = spec.params.safeParse(initial);
  if (parsed.success && !spec.review) {
    const input = attempt(() => spec.toInput(ctx, parsed.data));
    if (input !== null) {
      return { status: "ready", input, ...named(op, input, initial, loaded) };
    }
  }
  return {
    status: "form",
    fields: formFields(spec.params),
    initial,
    toInput: (values) => spec.toInput(ctx, values),
  };
}

/**
 * What a palette function waits for, read from the operation's input: a date
 * (a due field, or a `from`/`to` range) or a title.
 */
function waitingHint(op: OperationDescription): string | undefined {
  const shape = op.input.shape;
  // Inputs the form generator can't render (e.g. unions) have no field kinds.
  const fields = attempt(() => formFields(op.input, [...ITEM_KEYS])) ?? [];
  if (
    fields.some((f) => f.kind === "due") ||
    ("from" in shape && "to" in shape)
  ) {
    return "Type a date";
  }
  if (fields.some((f) => f.name === "title" && !f.optional)) {
    return "Add a title";
  }
  return undefined;
}

/** What a row that isn't ready still needs, for the first such field ⌘K has copy for. */
export function missingHint(plan: OperationPlan): string | undefined {
  if (plan.status === "waiting") return plan.hint;
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

/**
 * A ready row's label when loaded item fields are in its input: its summary
 * and their titles ("Remove from parent: Groceries").
 */
function named(
  op: OperationDescription,
  input: unknown,
  values: Record<string, unknown>,
  loaded: Loaded | undefined,
): { label: string } | Record<string, never> {
  const titles = Object.entries(loaded?.titles ?? {})
    .filter(([name]) => values[name] === loaded?.values[name])
    .map(([, title]) => title);
  if (titles.length === 0) return {};
  const summary = attempt(() => op.summary(input as never)) ?? op.label;
  return { label: `${summary}: ${titles.join(", ")}` };
}

/** The row's label: the summary of a ready input, else the operation's name. */
export function rowLabel(
  op: OperationDescription,
  plan: OperationPlan,
): string {
  if (plan.status !== "ready") return op.label;
  return (
    plan.label ?? attempt(() => op.summary(plan.input as never)) ?? op.label
  );
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
 * query names, by group: those named by their label first, then those named
 * only by a word ("due friday" lists before it reschedules), each in registry
 * order. Choosing one passes its context, with `text` set to what was typed
 * after its name.
 */
export function operationRows(
  ops: readonly OperationDescription[],
  ctx: Omit<PaletteContext, "text">,
  query: string,
  onChoose: (op: OperationDescription, ctx: PaletteContext) => void,
  loaded: Readonly<Record<string, Loaded>> = {},
): Record<OperationGroupId, CommandItem[]> {
  const rows: Record<OperationGroupId, CommandItem[]> = {
    create: [],
    actions: [],
  };
  const itemType = ctx.item?.type ?? null;
  const matched = ops.flatMap((op) => {
    if (op.palette === false || !appliesTo(op, itemType)) return [];
    const match = operationText(op, query);
    if (!match) return [];
    // "check the car" names a thing to find, not Complete: an operation that
    // takes no text matches only when nothing follows its name.
    if (match.text !== "" && consumesNoText(op)) return [];
    return [{ op, match }];
  });
  // Array sort is stable, so registry order holds within each kind of match.
  matched.sort(
    (a, b) => Number(a.match.by === "word") - Number(b.match.by === "word"),
  );
  for (const { op, match } of matched) {
    const full = { ...ctx, text: match.text };
    const plan = planOperation(op, full, loaded[op.id]);
    rows[op.group ?? "actions"].push(
      operationRow(op, plan, () => onChoose(op, full)),
    );
  }
  return rows;
}
