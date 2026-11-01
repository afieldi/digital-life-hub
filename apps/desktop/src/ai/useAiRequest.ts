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
import { PROVIDER_NAMES } from "./providers";

export type AiRunRequest = {
  text: string;
  itemId: string | null;
  actionId: string;
  kind: AiKind;
  /** The interpreter, when its own action and kind are what runs; omitted for a hand pick. */
  interpretedBy?: string;
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

type AiClient = ReturnType<typeof useTRPCClient>;

/** One running request: its outcome, and a way to stop it alone. */
export type AiRequestHandle = {
  /**
   * The finished state. A cancelled request resolves to idle, except a change
   * that was applied anyway, which is returned so Undo can be offered.
   */
  done: Promise<AiUiState>;
  /** Kills its CLI run, if any; the server request then ends `cancelled`. */
  cancel(): void;
};

function quietly(p: Promise<unknown>): void {
  p.catch(() => {});
}

/**
 * Starts one request, independent of any other: prepares it on the server,
 * runs the CLI on this device when the server hands one back, and posts its
 * output. `onProgress` reports the provider once the server has chosen it.
 */
export function startAiRequest(
  client: AiClient,
  req: AiRunRequest,
  defaultProvider: AiProviderId | null,
  onProgress?: (s: AiUiState) => void,
): AiRequestHandle {
  let cancelled = false;
  let runId: string | undefined;
  let provider = req.provider ?? defaultProvider;

  const finish = (s: AiUiState): AiUiState => {
    if (!cancelled) return s;
    if (s.result?.status === "suggested") {
      quietly(client.ai.discard.mutate({ requestId: s.result.requestId }));
    }
    return s.phase === "applied" ? s : IDLE;
  };
  const failed = (error: AiErrorData): AiUiState =>
    finish({ phase: "error", provider, request: req, error });

  const done = (async (): Promise<AiUiState> => {
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
        // Ends the server request: `failed` with `error`, else `cancelled`.
        const abandon = (error?: AiErrorData) =>
          quietly(client.ai.cancel.mutate({ requestId, error }));
        if (cancelled) {
          abandon();
          return IDLE;
        }
        runId = requestId;
        onProgress?.({ phase: "working", provider, request: req });
        let out: { stdout: string; exitCode: number };
        try {
          out = await runCli({
            runId: requestId,
            provider: cli,
            pathOverride: cliPathOverride(cli),
            system: job.system,
            prompt: job.prompt,
            schema: JSON.stringify(job.schema),
          });
        } catch (e) {
          const error = cliErrorToAi(e, cli);
          abandon(error ?? undefined);
          return error ? failed(error) : finish(IDLE);
        }
        if (cancelled) {
          abandon();
          return IDLE;
        }
        // With no output there is nothing for the server to check; the exit code is the error.
        if (out.exitCode !== 0 && out.stdout.trim() === "") {
          const error: AiErrorData = {
            code: "provider_error",
            message: `${PROVIDER_NAMES[cli]} returned an error: exited with code ${out.exitCode}.`,
          };
          abandon(error);
          return failed(error);
        }
        res = await client.ai.complete.mutate({ requestId, raw: out.stdout });
      }
      if (res.status === "run") throw new Error("unexpected second run");
      return finish({ phase: res.status, provider, request: req, result: res });
    } catch (e) {
      return failed(toAiError(e));
    }
  })();

  return {
    done,
    cancel() {
      cancelled = true;
      if (runId) quietly(cancelCli(runId));
    },
  };
}

/** Reverts an applied request; resolves to its summary, rejects with the user-facing message. */
export async function undoAiRequest(
  client: AiClient,
  requestId: string,
): Promise<string> {
  try {
    return (await client.ai.undo.mutate({ requestId })).summary;
  } catch (e) {
    throw new Error(toAiError(e).message);
  }
}

/**
 * The command bar's request: one at a time, shown through `state`. Starting
 * another or cancelling stops the current one, whose result is then ignored.
 */
export function useAiRequest(defaultProvider: AiProviderId | null) {
  const client = useTRPCClient();
  const [state, setStateValue] = useState<AiUiState>(IDLE);
  const stateRef = useRef(state);
  const current = useRef<{ cancel(): void } | null>(null);

  const setState = useCallback((s: AiUiState) => {
    stateRef.current = s;
    setStateValue(s);
  }, []);

  const cancel = useCallback(() => {
    current.current?.cancel();
    current.current = null;
    setState(IDLE);
  }, [setState]);

  const run = useCallback(
    async (req: AiRunRequest): Promise<AiUiState> => {
      current.current?.cancel();
      setState({
        phase: "working",
        provider: req.provider ?? defaultProvider,
        request: req,
      });
      const handle = startAiRequest(client, req, defaultProvider, (s) => {
        if (current.current === handle) setState(s);
      });
      current.current = handle;
      const s = await handle.done;
      if (current.current !== handle) return s.phase === "applied" ? s : IDLE;
      current.current = null;
      setState(s);
      return s;
    },
    [client, defaultProvider, setState],
  );

  /** Applies suggested option `option` (0-based). */
  const apply = useCallback(
    async (option: number): Promise<AiUiState> => {
      const s = stateRef.current;
      if (s.result?.status !== "suggested") return s;
      const { requestId } = s.result;
      const token = { cancel() {} };
      current.current = token;
      setState({ ...s, phase: "working" });
      let next: AiUiState;
      try {
        const { summary } = await client.ai.applyOption.mutate({
          requestId,
          option,
        });
        next = {
          phase: "applied",
          provider: s.provider,
          request: s.request,
          result: { requestId, status: "applied", summary },
        };
      } catch (e) {
        next = {
          phase: "error",
          provider: s.provider,
          request: s.request,
          error: toAiError(e),
        };
      }
      // A change made after the bar moved on is still returned, for Undo.
      if (current.current !== token)
        return next.phase === "applied" ? next : IDLE;
      current.current = null;
      setState(next);
      return next;
    },
    [client, setState],
  );

  /** Drops whatever is shown: discards unpicked options, cancels a running request. */
  const discard = useCallback(() => {
    const s = stateRef.current;
    if (s.phase === "working") return cancel();
    if (s.result?.status === "suggested") {
      quietly(client.ai.discard.mutate({ requestId: s.result.requestId }));
    }
    setState(IDLE);
  }, [client, cancel, setState]);

  const undo = useCallback(
    (requestId: string) => undoAiRequest(client, requestId),
    [client],
  );

  return useMemo(
    () => ({ state, run, apply, discard, undo, cancel }),
    [state, run, apply, discard, undo, cancel],
  );
}
