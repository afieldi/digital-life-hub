import {
  type AiActionDescription,
  ITEM_KEYS,
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
import type { CoreDeps } from "../trpc";
import { type AiContext, itemContext } from "./context";
import { PREAMBLE } from "./core-runners";
import { AiError } from "./errors";
import type { AiRunner, Resolved } from "./runners";

const WRAPPERS = new Set(["optional", "nullable", "default"]);
const TITLE_MATCHES = 3;

type Wrapped = z.ZodOptional<z.ZodType>;

/** The types of a `fields.item` field (through optional/nullable), or null. */
function itemTypesOf(field: z.ZodType): string[] | null {
  let inner = field;
  while (WRAPPERS.has(inner.def.type)) inner = (inner as Wrapped).def.innerType;
  const meta = (inner.meta() ?? {}) as { dlhField?: string; types?: string[] };
  return meta.dlhField === "item" ? (meta.types ?? []) : null;
}

/** `field` with its item id replaced by the item's title, keeping optional and nullable. */
function asTitle(field: z.ZodType, types: string[]): z.ZodType {
  if (WRAPPERS.has(field.def.type)) {
    const inner = asTitle((field as Wrapped).def.innerType, types);
    return field.def.type === "nullable" ? inner.nullable() : inner.optional();
  }
  return z
    .string()
    .min(1)
    .max(500)
    .describe(`The title of an item (${types.join(" or ")})`);
}

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

  const fill = Object.fromEntries(
    Object.entries(omitKeys(shape, ITEM_KEYS)).map(([k, f]) => {
      const types = itemFields.get(k);
      return [k, types ? asTitle(f, types) : f];
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

  /** The full input: the model's fields (minus a suggestion's label) and the item keys. */
  function inputOf(out: unknown, ctx: AiContext): Record<string, unknown> {
    const { label: _label, ...fields } = out as Record<string, unknown>;
    const keys: Record<string, unknown> = {};
    if ("id" in shape) keys.id = ctx.item?.id;
    if ("expectedUpdatedAt" in shape) keys.expectedUpdatedAt = ctx.version;
    const parsed = desc.input.safeParse({ ...fields, ...keys });
    if (!parsed.success) throw badOutput("The answer didn't fit the request");
    const subject = desc.subject(parsed.data);
    if (
      subject !== null &&
      subject !== (ctx.item?.id ?? null) &&
      !desc.effects.includes("writeOtherItems")
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
    async resolve(deps, out): Promise<Resolved> {
      const resolved: Record<string, unknown> = { ...(out as object) };
      let choice: { key: string; matches: Match[] } | null = null;
      for (const [key, types] of itemFields) {
        const value = resolved[key];
        if (typeof value !== "string") continue;
        const matches = await matchTitle(deps, value, types);
        resolved[key] = matches[0]?.id;
        if (matches.length > 1 && !choice) choice = { key, matches };
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
    async apply(_w, out, ctx, tools) {
      if (!tools) throw new Error(`${desc.id} runs through Core's tools`);
      return (await tools.mutate(op, inputOf(out, ctx))).undo;
    },
    async undo(_w, record, tools) {
      if (!tools) throw new Error(`${desc.id} runs through Core's tools`);
      await tools.revert(op, (record as { record?: unknown }).record);
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
