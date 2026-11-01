import type {
  AiCompleteRequest,
  AiCompleteResult,
  AiProvider,
} from "./providers";

/** Marks a request the scripted fake answers with text that is not JSON. */
export const BAD_MARKER = "[bad]";

export const DEV_FAKE_MODEL = "fake-model";

type Shape = { properties?: Record<string, unknown> };
type OptionsShape = { items?: Shape };

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
    if ("title" in props) {
      return { raw: JSON.stringify({ title: "Fake new title" }) };
    }
    const optionProps = (props.options as OptionsShape | undefined)?.items
      ?.properties;
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
