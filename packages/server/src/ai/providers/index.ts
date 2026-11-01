import type { AiProviderId } from "@dlh/core";

export interface AiCompleteRequest {
  system: string;
  prompt: string;
  schema: object;
  model: string;
  signal: AbortSignal;
}

export interface AiCompleteResult {
  raw: string;
  usage?: { input: number; output: number; costUsd?: number };
}

export interface AiProvider {
  id: AiProviderId;
  complete(req: AiCompleteRequest): Promise<AiCompleteResult>;
}

export { unwrapCliOutput } from "./cli";
export { createOpenRouter } from "./openrouter";
