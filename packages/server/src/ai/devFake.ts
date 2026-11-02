import type {
  AiCompleteRequest,
  AiCompleteResult,
  AiProvider,
} from "./providers";

/** Marks a request the scripted fake answers with text that is not JSON. */
export const BAD_MARKER = "[bad]";

export const DEV_FAKE_MODEL = "fake-model";

type Shape = { properties?: Record<string, unknown>; required?: string[] };
type OptionsShape = { items?: Shape };
type Property = { enum?: unknown[] };

const day = (offset: number) =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

/** Fake values for operation inputs, by property name. */
const FILLERS: Record<string, (p: Property) => unknown> = {
  title: () => "Fake new title",
  due: () => ({ date: day(1) }),
  priority: (p) => p.enum?.[0],
  position: () => "top",
  parentId: () => "Fake parent",
  from: () => day(0),
  to: () => day(7),
};

/**
 * An operation's input filled from `props`: every property it has a filler
 * for, except an optional `parentId` (a title that would have to match).
 */
function fillOperation(shape: Shape): Record<string, unknown> | null {
  const props = shape.properties ?? {};
  const out: Record<string, unknown> = {};
  for (const [name, prop] of Object.entries(props)) {
    const fill = FILLERS[name];
    if (!fill) continue;
    if (name === "parentId" && !shape.required?.includes(name)) continue;
    out[name] = fill(prop as Property);
  }
  return Object.keys(out).length > 0 ? out : null;
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
    // An operation's suggestion: options are its input plus a label.
    if (optionShape && optionProps && "label" in optionProps) {
      const option = fillOperation(optionShape) ?? {};
      return {
        raw: JSON.stringify({ options: [{ ...option, label: "Fake option" }] }),
      };
    }
    const filled = fillOperation(req.schema as Shape);
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
