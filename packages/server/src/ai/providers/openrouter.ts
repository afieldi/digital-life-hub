import type { AiProvider } from "./index";
import { createOpenAiCompatible } from "./openaiCompatible";

export function createOpenRouter(opts: {
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): AiProvider {
  return createOpenAiCompatible({
    ...opts,
    id: "openrouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
  });
}
