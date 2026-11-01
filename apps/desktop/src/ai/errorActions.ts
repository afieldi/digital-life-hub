import type { AiErrorData, AiProviderId } from "@dlh/core";
import { otherProvider, PROVIDER_NAMES } from "./providers";
import type { AiRunRequest } from "./useAiRequest";

export type AiAction = { label: string; onAction: () => void };

/**
 * What a failed request offers (see the spec's Errors table). "Use <other>"
 * retries once with the other provider, so it is not offered again after it.
 */
export function errorActions(
  error: AiErrorData,
  request: AiRunRequest,
  provider: AiProviderId,
  handlers: { retry: (req: AiRunRequest) => void; openSettings: () => void },
): AiAction[] {
  const tryAgain = {
    label: "Try again",
    onAction: () => handlers.retry(request),
  };
  const other = otherProvider(provider);
  const useOther: AiAction[] =
    request.provider === undefined
      ? [
          {
            label: `Use ${PROVIDER_NAMES[other]}`,
            onAction: () => handlers.retry({ ...request, provider: other }),
          },
        ]
      : [];
  switch (error.code) {
    case "bad_output":
    case "timeout":
      return [tryAgain, ...useOther];
    case "provider_unavailable":
      return [
        ...useOther,
        { label: "Open Settings", onAction: handlers.openSettings },
      ];
    case "provider_error":
      return [tryAgain];
    case "stale":
    case "expired":
      return [{ label: "Run again", onAction: () => handlers.retry(request) }];
    case "not_found":
      return [];
  }
}
