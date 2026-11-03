import {
  type AiActionDescription,
  dueFromLocal,
  ITEM_KEYS,
  localDueValue,
  type OperationDescription,
  operationList,
  toAiAction,
} from "@dlh/core";
import { items } from "@dlh/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { searchItems } from "../items/search";
import type {
  ImplementedMutation,
  ImplementedOperation,
} from "../operations/implement";
import { undoToken } from "../operations/undo";
import type { CoreDeps } from "../trpc";
import { type AiContext, itemContext } from "./context";
import { PREAMBLE } from "./core-runners";
import { AiError } from "./errors";
import type { AiRunner, Resolved } from "./runners";

const WRAPPERS = new Set(["optional", "nullable", "default"]);
const TITLE_MATCHES = 3;

type Wrapped = z.ZodOptional<z.ZodType>;

type FieldMeta = { dlhField?: string; types?: string[] };

/** A form field's tag and item types, through optional/nullable. */
function metaOf(field: z.ZodType): FieldMeta {
  let inner = field;
  while (WRAPPERS.has(inner.def.type)) inner = (inner as Wrapped).def.innerType;
  return (inner.meta() ?? {}) as FieldMeta;
}

/** The types of a `fields.item` field (through optional/nullable), or null. */
function itemTypesOf(field: z.ZodType): string[] | null {
  const meta = metaOf(field);
  return meta.dlhField === "item" ? (meta.types ?? []) : null;
}

const isDueField = (field: z.ZodType) => metaOf(field).dlhField === "due";

/** The input keys that name items (`fields.item`). */
function itemFieldKeys(desc: OperationDescription): string[] {
  const shape = desc.input.shape as Record<string, z.ZodType>;
  return Object.keys(shape).filter((k) => {
    const f = shape[k];
    return f !== undefined && itemTypesOf(f) !== null;
  });
}

/**
 * Whether an AI request on `onScreen` may run `desc` with `input`: its
 * subject is the item on screen, none, or an item one of its item fields
 * names (AI fills those by title, resolved by search: addParent's parent).
 * `writeOtherItems` is the caller's to check.
 */
export function subjectAllowed(
  desc: OperationDescription,
  input: Record<string, unknown>,
  onScreen: string | null,
): boolean {
  const subject = desc.subject(input);
  if (subject === null || subject === onScreen) return true;
  return itemFieldKeys(desc).some((k) => input[k] === subject);
}

/** `field` with its inner schema replaced by `inner`, keeping optional and nullable. */
function rewrap(field: z.ZodType, inner: z.ZodType): z.ZodType {
  if (!WRAPPERS.has(field.def.type)) return inner;
  const wrapped = rewrap((field as Wrapped).def.innerType, inner);
  return field.def.type === "nullable"
    ? wrapped.nullable()
    : wrapped.optional();
}

/** An item field as the model fills it: the item's title. */
const titleOf = (types: string[]) =>
  z
    .string()
    .min(1)
    .max(500)
    .describe(`The title of an item (${types.join(" or ")})`);

function omitKeys(
  shape: Record<string, z.ZodType>,
  keys: readonly string[],
): Record<string, z.ZodType> {
  return Object.fromEntries(
    Object.entries(shape).filter(([k]) => !keys.includes(k)),
  );
}

/** "The answer was wrong for this action": the gateway records it as `bad_output`. */
function badOutput(message: string): AiError {
  return new AiError("bad_output", `${message}, so nothing was changed.`);
}

const norm = (s: string) => s.trim().toLowerCase();

type Match = { id: string; title: string };

/** The live item `id`, if it is one of `types`. */
async function itemById(
  deps: CoreDeps,
  id: string,
  types: string[],
): Promise<Match[]> {
  return deps.db
    .select({ id: items.id, title: items.title })
    .from(items)
    .where(
      and(
        eq(items.id, id),
        isNull(items.deletedAt),
        inArray(items.type, types),
      ),
    );
}

/**
 * The items a title the model gave may mean: one when it is clear (an item id
 * from the context, the only exact title, or the only result), else up to
 * three. Throws `not_found` when nothing matches.
 */
async function matchTitle(
  deps: CoreDeps,
  value: string,
  types: string[],
): Promise<Match[]> {
  if (z.uuid().safeParse(value).success) {
    const byId = await itemById(deps, value, types);
    if (byId.length === 1) return byId;
  }
  const results = await searchItems(deps.db, { query: value, types });
  const exact = results.filter((r) => norm(r.title) === norm(value));
  if (exact.length === 1) return exact;
  if (results.length === 0) {
    throw new AiError(
      "not_found",
      `Nothing called “${value.trim()}” was found, so nothing was changed.`,
    );
  }
  return (exact.length > 1 ? exact : results).slice(0, TITLE_MATCHES);
}

/**
 * An operation as an AI action. The model fills the input except the item
 * keys, which come from the item on screen, and names items by title, which
 * `resolve` turns into ids. Mutations suggest or do through `runMutation`;
 * queries answer with the rows they return.
 */
export function operationAiRunner(op: ImplementedOperation): AiRunner {
  const { desc } = op;
  const action: AiActionDescription = toAiAction(desc);
  const shape = desc.input.shape as Record<string, z.ZodType>;
  const itemFields = new Map<string, string[]>();
  for (const [key, field] of Object.entries(shape)) {
    const types = itemTypesOf(field);
    if (types) itemFields.set(key, types);
  }
  const system = `${PREAMBLE}
Fill in the input for "${desc.label}": ${desc.description}
Where a field names another item, give that item's title.`;
  const context = (deps: CoreDeps, itemId: string | null) =>
    itemContext(deps, itemId);

  if (op.kind === "query") {
    return {
      action,
      context,
      system,
      output: { ask: z.object(omitKeys(shape, ["timeZone"])).strict() },
      async list(deps, out, ctx) {
        const zone =
          "timeZone" in shape ? { timeZone: ctx.timeZone ?? "UTC" } : {};
        const input = desc.input.safeParse({ ...(out as object), ...zone });
        if (!input.success)
          throw badOutput("The answer didn't fit the request");
        const list = operationList.parse(await op.impl.run(deps, input.data));
        return {
          heading: list.heading,
          items: list.items.map(({ id, type, title, archivedAt }) => ({
            id,
            type,
            title,
            archivedAt,
          })),
        };
      },
    };
  }

  // The model names items by title and gives due times in local time.
  const fill = Object.fromEntries(
    Object.entries(omitKeys(shape, ITEM_KEYS)).map(([k, f]) => {
      const types = itemFields.get(k);
      if (types) return [k, rewrap(f, titleOf(types))];
      return [k, isDueField(f) ? rewrap(f, localDueValue) : f];
    }),
  );
  const doSchema = z.object(fill).strict();
  return mutationRunner(op, action, context, system, itemFields, {
    do: doSchema,
    suggest: z
      .object({
        options: z
          .array(doSchema.extend({ label: z.string().min(1).max(200) }))
          .min(1)
          .max(3),
      })
      .strict(),
  });
}

/**
 * An operation runner's undo record: tagged, so Core soft-deletes `created`
 * only for these and never for a hand-written runner's record.
 */
export const operationUndo = z.object({
  kind: z.literal("operation"),
  operation: z.string(),
  token: undoToken,
});
export type OperationUndo = z.infer<typeof operationUndo>;

function mutationRunner(
  op: ImplementedMutation,
  action: AiActionDescription,
  context: AiRunner["context"],
  system: string,
  itemFields: Map<string, string[]>,
  output: AiRunner["output"],
): AiRunner {
  const { desc } = op;
  const shape = desc.input.shape as Record<string, z.ZodType>;
  const dueFields = Object.keys(shape).filter((k) => {
    const f = shape[k];
    return f !== undefined && isDueField(f);
  });

  /** The full input: the model's fields (minus a suggestion's label) and the item keys. */
  function inputOf(out: unknown, ctx: AiContext): Record<string, unknown> {
    const { label: _label, ...fields } = out as Record<string, unknown>;
    const keys: Record<string, unknown> = {};
    if ("id" in shape) keys.id = ctx.item?.id;
    if ("expectedUpdatedAt" in shape) keys.expectedUpdatedAt = ctx.version;
    const parsed = desc.input.safeParse({ ...fields, ...keys });
    if (!parsed.success) throw badOutput("The answer didn't fit the request");
    if (
      !desc.effects.includes("writeOtherItems") &&
      !subjectAllowed(desc, parsed.data, ctx.item?.id ?? null)
    ) {
      throw badOutput("The answer changes another item than the one open");
    }
    return parsed.data;
  }

  return {
    action,
    context,
    system,
    output,
    async resolve(deps, out, opts): Promise<Resolved> {
      const resolved: Record<string, unknown> = { ...(out as object) };
      // Local due times are set in the request's zone (UTC when none was sent).
      for (const key of dueFields) {
        const local = localDueValue.safeParse(resolved[key]);
        if (local.success) {
          resolved[key] = dueFromLocal(local.data, opts?.timeZone ?? "UTC");
        }
      }
      let choice: { key: string; value: string; matches: Match[] } | null =
        null;
      for (const [key, types] of itemFields) {
        const value = resolved[key];
        if (typeof value !== "string") continue;
        const matches = await matchTitle(deps, value, types);
        resolved[key] = matches[0]?.id;
        if (matches.length < 2) continue;
        // Options pick one field; a second ambiguous one would be guessed.
        if (choice) {
          throw badOutput(
            `More than one item name was unclear (“${choice.value}” and “${value}”)`,
          );
        }
        choice = { key, value, matches };
      }
      if (!choice) return { out: resolved };
      const { key, matches } = choice;
      return {
        options: matches.map((m) => ({
          label: `${desc.label}: ${m.title}`,
          out: { ...resolved, [key]: m.id },
        })),
      };
    },
    operation: op,
    async apply(_w, out, ctx, tools): Promise<OperationUndo> {
      const { mutate } = tools;
      const { undo } = await mutate(op, inputOf(out, ctx));
      return { kind: "operation", operation: desc.id, token: undo };
    },
    async undo(_w, record, tools) {
      const { revert } = tools;
      await revert(op, operationUndo.parse(record).token.record);
    },
    summary(out, ctx) {
      try {
        return desc.summary(inputOf(out, ctx));
      } catch {
        return desc.label;
      }
    },
  };
}
