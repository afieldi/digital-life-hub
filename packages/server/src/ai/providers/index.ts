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

/** A provider that also answers decision-model questions (`POST /v1/decisions`). */
export interface AiDecisionProvider extends AiProvider {
  decide(req: {
    model: string;
    input: string;
    question: {
      name: string;
      instructions: string;
      choices: { value: string; description: string }[];
    };
    signal: AbortSignal;
  }): Promise<{
    choice: string;
    confidence: number;
    probabilities: Record<string, number>;
    usage?: { input: number; output: number; costUsd?: number };
  }>;
}

export { unwrapCliOutput } from "./cli";
export { createOpenRouter } from "./openrouter";
export { createVercelGateway } from "./vercel";
