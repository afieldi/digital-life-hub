import type {
  AiCompleteRequest,
  AiCompleteResult,
  AiProvider,
} from "./providers";
import type { AiRunner } from "./runners";

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

/**
 * A scripted OpenRouter stand-in for dev and end-to-end runs: it answers with
 * the runner's own `devFake` when it has one, else by the shape of the
 * requested JSON schema, so it needs no queue. A prompt containing `[bad]`
 * gets text that is not JSON.
 */
export function createScriptedFake(runners: Iterable<AiRunner>): AiProvider {
  const own = [...runners].filter((r) => r.devFake);
  return {
    id: "openrouter",
    async complete(req: AiCompleteRequest): Promise<AiCompleteResult> {
      if (req.prompt.includes(BAD_MARKER)) return { raw: "not json" };
      const props = (req.schema as Shape).properties ?? {};
      // The gateway sends a runner's own system prompt, then a fixed line.
      const runner = own.find((r) => req.system.startsWith(r.system));
      const scripted = runner?.devFake?.({
        prompt: req.prompt,
        suggest: "options" in props,
      });
      if (scripted !== undefined) return { raw: JSON.stringify(scripted) };
      return shapedAnswer(req);
    },
  };
}

/** An answer guessed from the requested schema: Core's actions and operations. */
function shapedAnswer(req: AiCompleteRequest): AiCompleteResult {
  const props = (req.schema as Shape).properties ?? {};
  if ("answer" in props) {
    return { raw: JSON.stringify({ answer: "A fake answer.", used: [] }) };
  }
  const optionShape = (props.options as OptionsShape | undefined)?.items;
  const optionProps = optionShape?.properties;
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
  throw new Error("scripted fake: unknown output schema");
}

/**
 * The scripted fake for `runners` as `ai.providers`, plus a default model. The
 * API uses it only when its config allows (`AI_FAKE_PROVIDER=1` in
 * development), so it can never stand in for a real provider elsewhere.
 */
export function devFakeAi(runners: Iterable<AiRunner>): {
  providers: { openrouter: AiProvider };
  defaultModel: string;
} {
  return {
    providers: { openrouter: createScriptedFake(runners) },
    defaultModel: DEV_FAKE_MODEL,
  };
}
