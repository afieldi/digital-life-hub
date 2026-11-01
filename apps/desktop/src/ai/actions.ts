import { type AiActionDescription, coreAiActions } from "@dlh/core";
import { registry } from "../modules";

/** Every AI action this app knows: the core ones and those modules add. */
export const ALL_ACTIONS: AiActionDescription[] = [
  ...Object.values(coreAiActions),
  ...registry.aiActions,
];
