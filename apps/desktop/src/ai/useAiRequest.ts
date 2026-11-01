import {
  type AiErrorData,
  type AiKind,
  type AiProviderId,
  type AiResult,
  aiErrorData,
} from "@dlh/core";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTRPCClient } from "../api/client";
import { cancelCli, cliErrorToAi, cliPathOverride, runCli } from "./cli";

export type AiRunRequest = {
  text: string;
  itemId: string | null;
  actionId: string;
  kind: AiKind;
  interpretedBy: string;
  /** Overrides the default provider ("Use <other>"). */
  provider?: AiProviderId;
};

export type AiFinishedResult = Exclude<AiResult, { status: "run" }>;

export type AiUiState = {
  phase: "idle" | "working" | "answered" | "suggested" | "applied" | "error";
  /** Who runs (or ran) the request; null when idle. */
  provider: AiProviderId | null;
  request?: AiRunRequest;
  result?: AiFinishedResult;
  error?: AiErrorData;
};

const IDLE: AiUiState = { phase: "idle", provider: null };

const GENERIC_ERROR: AiErrorData = {
  code: "provider_error",
  message: "Something went wrong, so nothing was changed.",
};

/** The user-facing copy the server attached to an AI failure (`data.ai`). */
export function toAiError(e: unknown): AiErrorData {
  if (e instanceof TRPCClientError) {
    const parsed = aiErrorData.safeParse(
      (e.data as { ai?: unknown } | undefined)?.ai,
    );
    if (parsed.success) return parsed.data;
  }
  return GENERIC_ERROR;
}

/** One request in flight; replaced (and so ignored) when another starts or it is cancelled. */
type Active = { runId?: string };

/**
 * Runs AI requests from the app: prepares on the server, runs the CLI on this
 * device when the server hands one back, and posts its output. One request at
 * a time; starting another or cancelling makes the old one's result ignored.
 */
export function useAiRequest(defaultProvider: AiProviderId | null) {
  const client = useTRPCClient();
  const [state, setStateValue] = useState<AiUiState>(IDLE);
  const stateRef = useRef(state);
  const active = useRef<Active | null>(null);

  const setState = useCallback((s: AiUiState) => {
    stateRef.current = s;
    setStateValue(s);
  }, []);

  const quietly = useCallback((p: Promise<unknown>) => {
    p.catch(() => {});
  }, []);

  /**
   * Shows `s` if `token` is still the live request. A stale one resolves to
   * idle, except an applied change, which is returned so Undo can be offered.
   */
  const settle = useCallback(
    (token: Active, s: AiUiState): AiUiState => {
      if (active.current === token) {
        active.current = null;
        setState(s);
        return s;
      }
      if (s.result?.status === "suggested") {
        quietly(client.ai.discard.mutate({ requestId: s.result.requestId }));
      }
      return s.phase === "applied" ? s : IDLE;
    },
    [client, setState, quietly],
  );

  const run = useCallback(
    async (req: AiRunRequest): Promise<AiUiState> => {
      const token: Active = {};
      active.current = token;
      let provider = req.provider ?? defaultProvider;
      setState({ phase: "working", provider, request: req });
      try {
        let res = await client.ai.prepare.mutate({
          text: req.text,
          itemId: req.itemId ?? undefined,
          actionId: req.actionId,
          kind: req.kind,
          interpretedBy: req.interpretedBy,
          provider: req.provider,
        });
        if (res.status === "run") {
          const { requestId } = res;
          const job = res.run;
          provider = job.provider;
          if (job.provider === "openrouter") throw new Error("not a CLI run");
          const cli = job.provider;
          const abandon = () => quietly(client.ai.cancel.mutate({ requestId }));
          if (active.current !== token) {
            abandon();
            return IDLE;
          }
          token.runId = requestId;
          setState({ phase: "working", provider, request: req });
          let stdout: string;
          try {
            ({ stdout } = await runCli({
              runId: requestId,
              provider: cli,
              pathOverride: cliPathOverride(cli),
              system: job.system,
              prompt: job.prompt,
              schema: JSON.stringify(job.schema),
            }));
          } catch (e) {
            abandon();
            const error = cliErrorToAi(e, cli);
            return settle(
              token,
              error ? { phase: "error", provider, request: req, error } : IDLE,
            );
          }
          if (active.current !== token) {
            abandon();
            return IDLE;
          }
          res = await client.ai.complete.mutate({ requestId, raw: stdout });
        }
        if (res.status === "run") throw new Error("unexpected second run");
        return settle(token, {
          phase: res.status,
          provider,
          request: req,
          result: res,
        });
      } catch (e) {
        return settle(token, {
          phase: "error",
          provider,
          request: req,
          error: toAiError(e),
        });
      }
    },
    [client, defaultProvider, setState, settle, quietly],
  );

  /** Applies suggested option `option` (0-based). */
  const apply = useCallback(
    async (option: number): Promise<AiUiState> => {
      const s = stateRef.current;
      if (s.result?.status !== "suggested") return s;
      const { requestId } = s.result;
      const token: Active = {};
      active.current = token;
      setState({ ...s, phase: "working" });
      try {
        const { summary } = await client.ai.applyOption.mutate({
          requestId,
          option,
        });
        return settle(token, {
          phase: "applied",
          provider: s.provider,
          request: s.request,
          result: { requestId, status: "applied", summary },
        });
      } catch (e) {
        return settle(token, {
          phase: "error",
          provider: s.provider,
          request: s.request,
          error: toAiError(e),
        });
      }
    },
    [client, setState, settle],
  );

  /** Stops a running request; the CLI is killed and the server request ends `cancelled`. */
  const cancel = useCallback(() => {
    const cur = active.current;
    active.current = null;
    if (cur?.runId) quietly(cancelCli(cur.runId));
    setState(IDLE);
  }, [setState, quietly]);

  /** Drops whatever is shown: discards unpicked options, cancels a running request. */
  const discard = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === "working") return cancel();
    if (s.result?.status === "suggested") {
      quietly(client.ai.discard.mutate({ requestId: s.result.requestId }));
    }
    setState(IDLE);
  }, [client, cancel, setState, quietly]);

  /** Reverts an applied request; resolves to its summary, rejects with the user-facing message. */
  const undo = useCallback(
    async (requestId: string): Promise<string> => {
      try {
        return (await client.ai.undo.mutate({ requestId })).summary;
      } catch (e) {
        throw new Error(toAiError(e).message);
      }
    },
    [client],
  );

  return useMemo(
    () => ({ state, run, apply, discard, undo, cancel }),
    [state, run, apply, discard, undo, cancel],
  );
}
