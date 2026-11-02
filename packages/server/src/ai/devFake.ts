import type {
  AiCompleteRequest,
  AiCompleteResult,
  AiProvider,
} from "./providers";

/** Marks a request the scripted fake answers with text that is not JSON. */
export const BAD_MARKER = "[bad]";

export const DEV_FAKE_MODEL = "fake-model";

type Shape = { properties?: Record<string, unknown>; required?: string[] };
type OptionsShape = { items?: Shape; minItems?: number };
type Property = { enum?: unknown[] };

const MONTHS = "JanFebMarAprMayJunJulAugSepOctNovDec";

/**
 * The day the prompt's "Today is Fri, Nov 6, 2026 (…)" line names, at UTC
 * midnight, so the fake agrees with the device's day; the UTC day without one.
 */
export function promptToday(prompt: string): Date {
  const m = /Today is \w+, (\w{3}) (\d{1,2}), (\d{4})/.exec(prompt);
  const month = m ? MONTHS.indexOf(m[1] ?? "") / 3 : -1;
  if (m && month >= 0) {
    return new Date(Date.UTC(Number(m[3]), month, Number(m[2])));
  }
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

const dayAfter = (today: Date, offset: number) =>
  new Date(today.getTime() + offset * 86_400_000).toISOString().slice(0, 10);

/** Fake values for operation inputs, by property name. */
const FILLERS: Record<string, (p: Property, today: Date) => unknown> = {
  title: () => "Fake new title",
  due: (_p, today) => ({ date: dayAfter(today, 1) }),
  priority: (p) => p.enum?.[0],
  position: () => "top",
  parentId: () => "Fake parent",
  // Today through a week today (`to` is the day after the last): any
  // weekday named from today, today's own weekday included, falls inside.
  from: (_p, today) => dayAfter(today, 0),
  to: (_p, today) => dayAfter(today, 8),
};

/**
 * An operation's input filled from `props`: every property it has a filler
 * for, except an optional `parentId` (a title that would have to match).
 */
function fillOperation(
  shape: Shape,
  today: Date,
): Record<string, unknown> | null {
  const props = shape.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(props)) {
    const fill = FILLERS[name];
    if (!fill) continue;
    if (name === "parentId" && !shape.required?.includes(name)) continue;
    out[name] = fill(prop as Property, today);
  }
  return Object.keys(out).length > 0 ? out : null;
}

const sameKeys = (o: Record<string, unknown> | undefined, keys: string[]) =>
  o !== undefined && Object.keys(o).sort().join() === [...keys].sort().join();

const FAKE_STEPS = ["One", "Two", "Three"].map((n) => `Fake subtask ${n}`);
const CONTEXT_ID = /\(id ([0-9a-f-]{36})\)/g;

/**
 * Tasks' hand-written actions, by their output's property names: subtasks
 * (Break down), notes (Rewrite notes) and order/advice (Plan today, which picks
 * the first three task ids listed in the prompt).
 */
function fakeTasksAnswer(
  props: Record<string, unknown>,
  options: OptionsShape | undefined,
  prompt: string,
): unknown {
  const optionProps = options?.items?.properties;
  if (sameKeys(props, ["subtasks"])) return { subtasks: FAKE_STEPS };
  // A checklist of titles; an operation with no fields offers labels too, but at least one.
  if (sameKeys(optionProps, ["label"]) && (options?.minItems ?? 0) >= 3) {
    return { options: FAKE_STEPS.map((label) => ({ label })) };
  }
  if (sameKeys(props, ["notes"])) return { notes: "Fake rewritten notes." };
  if (sameKeys(optionProps, ["label", "notes"])) {
    return {
      options: ["Shorter", "Clearer"].map((label) => ({
        label,
        notes: `Fake ${label.toLowerCase()} notes.`,
      })),
    };
  }
  if (sameKeys(props, ["order", "advice"])) {
    const ids = [...prompt.matchAll(CONTEXT_ID)].map((m) => m[1]);
    return {
      order: ids
        .slice(0, 3)
        .map((taskId) => ({ taskId, reason: "Fake reason." })),
      advice: "Fake advice.",
    };
  }
  return null;
}

/**
 * A scripted OpenRouter stand-in for end-to-end tests: it answers by the shape
 * of the requested JSON schema, so it needs no queue. A prompt containing
 * `[bad]` gets text that is not JSON.
 */
export const scriptedFakeProvider: AiProvider = {
  id: "openrouter",
  async complete(req: AiCompleteRequest): Promise<AiCompleteResult> {
    if (req.prompt.includes(BAD_MARKER)) return { raw: "not json" };
    const props = (req.schema as Shape).properties ?? {};
    if ("answer" in props) {
      return { raw: JSON.stringify({ answer: "A fake answer.", used: [] }) };
    }
    const optionShape = (props.options as OptionsShape | undefined)?.items;
    const optionProps = optionShape?.properties;
    const tasks = fakeTasksAnswer(
      props,
      props.options as OptionsShape | undefined,
      req.prompt,
    );
    if (tasks) return { raw: JSON.stringify(tasks) };
    // An operation's suggestion: options are its input plus a label.
    if (optionShape && optionProps && "label" in optionProps) {
      const option = fillOperation(optionShape, promptToday(req.prompt)) ?? {};
      return {
        raw: JSON.stringify({ options: [{ ...option, label: "Fake option" }] }),
      };
    }
    const filled = fillOperation(req.schema as Shape, promptToday(req.prompt));
    if (filled) return { raw: JSON.stringify(filled) };
    // An operation whose input is only the item on screen (Complete).
    if (Object.keys(props).length === 0) return { raw: "{}" };
    if (optionProps && "title" in optionProps) {
      return {
        raw: JSON.stringify({
          options: ["One", "Two", "Three"].map((n) => ({
            title: `Fake title ${n}`,
            reason: `Reason ${n}.`,
          })),
        }),
      };
    }
    if (optionProps && "summary" in optionProps) {
      return {
        raw: JSON.stringify({
          options: [{ summary: "Deletes this item." }],
        }),
      };
    }
    throw new Error("scriptedFakeProvider: unknown output schema");
  },
};

/**
 * The scripted fake as `ai.providers` plus a default model, only when
 * `AI_FAKE_PROVIDER=1` and `NODE_ENV=development`; null otherwise, so it can
 * never stand in for a real provider elsewhere.
 */
export function devFakeAi(env: Record<string, string | undefined>): {
  providers: { openrouter: AiProvider };
  defaultModel: string;
} | null {
  if (env.AI_FAKE_PROVIDER !== "1" || env.NODE_ENV !== "development") {
    return null;
  }
  return {
    providers: { openrouter: scriptedFakeProvider },
    defaultModel: DEV_FAKE_MODEL,
  };
}
