import { useOpenItem } from "@dlh/client";
import { type AiKind, applicableActions } from "@dlh/core";
import { closeToast, Kbd, toast } from "@dlh/ui";
import { skipToken, useQuery } from "@tanstack/react-query";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTRPC, useTRPCClient } from "../api/client";
import { AiResult } from "./AiResult";
import { ALL_ACTIONS } from "./actions";
import { errorActions } from "./errorActions";
import { PROVIDER_NAMES } from "./providers";
import { allowedKinds, UnderstoodAs } from "./UnderstoodAs";
import {
  type AiRunRequest,
  startAiRequest,
  undoAiRequest,
  useAiRequest,
} from "./useAiRequest";
import { useInterpretation } from "./useInterpretation";

const APPLIED_TOAST_MS = 10_000;

/** The person's pick in the Understood as row, for the text it was made on. */
type Choice = { text: string; actionId: string | null; kind: AiKind | null };

function step<T>(list: readonly T[], current: T, by: 1 | -1): T {
  const i = list.indexOf(current);
  return list[(i + by + list.length) % list.length] as T;
}

/**
 * Ask AI in the command bar: the Understood as row, the result slot, the keys,
 * and the toasts for Do. The Shell passes the bar's state in and spreads the
 * returned props onto `CommandBar`.
 */
export function useAskAi({
  open,
  setOpen,
  query,
  setQuery,
  navigate,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  setQuery: (query: string) => void;
  navigate: (to: string) => void;
}): {
  interpretation?: ReactNode;
  result?: ReactNode;
  footer?: ReactNode;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => boolean;
  onQueryChange: (query: string) => void;
  onOpenChange: (open: boolean) => void;
} {
  const trpc = useTRPC();
  const openItemId = useOpenItem();
  const item = useQuery({
    ...trpc.items.get.queryOptions(openItemId ? { id: openItemId } : skipToken),
    enabled: open && openItemId !== null,
    retry: false,
  });
  const settings = useQuery({
    ...trpc.ai.settings.get.queryOptions(),
    enabled: open,
    retry: false,
  });
  const defaultProvider = settings.data?.defaultProvider ?? null;

  // undefined while the open item's type is loading; a missing item counts as none.
  const itemType: string | null | undefined =
    openItemId === null || item.isError ? null : item.data?.type;
  const itemId = itemType ? openItemId : null;
  const actions = useMemo(
    () =>
      itemType === undefined ? null : applicableActions(ALL_ACTIONS, itemType),
    [itemType],
  );
  const { interpretation: interp, current: interpCurrent } = useInterpretation(
    open ? query : "",
    itemType ?? null,
    actions,
  );

  const [choice, setChoice] = useState<Choice | null>(null);
  const pick = choice?.text === query ? choice : null;
  const candidates = interp
    ? [{ actionId: interp.actionId, kind: interp.kind }, ...interp.alternatives]
    : [];
  const candidate =
    candidates.find((c) => c.actionId === pick?.actionId) ?? candidates[0];
  const action = candidate
    ? actions?.find((a) => a.id === candidate.actionId)
    : undefined;
  const kinds = action ? allowedKinds(action) : [];
  const wanted = pick?.kind ?? candidate?.kind;
  const kind = wanted && kinds.includes(wanted) ? wanted : kinds[0];
  // The no-match fallback offers no AI: the bar keeps its own rows and keys.
  const showRow =
    open && query.trim() !== "" && !!interp?.matched && !!action && !!kind;

  const client = useTRPCClient();
  const bar = useAiRequest(defaultProvider);

  const closeBar = useCallback(() => {
    bar.discard();
    setOpen(false);
  }, [bar, setOpen]);

  // Error toasts outlive renders; retry through whatever runRequest is current.
  const retryRef = useRef<(req: AiRunRequest) => void>(() => {});

  const showError = useCallback(
    (state: typeof bar.state) => {
      if (!state.error || !state.request || !state.provider) return;
      toast(state.error.message, {
        tone: "error",
        timeout: 0,
        actions: errorActions(state.error, state.request, state.provider, {
          retry: (req) => retryRef.current(req),
          openSettings: () => navigate("/settings"),
        }),
      });
    },
    [navigate],
  );

  const showOptions = useCallback(
    (req: AiRunRequest) => {
      const suggest = { ...req, kind: "suggest" as const };
      setChoice({ text: req.text, actionId: req.actionId, kind: "suggest" });
      setQuery(req.text);
      setOpen(true);
      void bar.run(suggest);
    },
    [bar, setQuery, setOpen],
  );

  const showApplied = useCallback(
    (requestId: string, summary: string, req: AiRunRequest | undefined) => {
      const acted = ALL_ACTIONS.find((a) => a.id === req?.actionId);
      const canSuggest =
        req?.kind === "do" &&
        !!acted &&
        allowedKinds(acted).includes("suggest");
      toast(summary, {
        tone: "success",
        timeout: APPLIED_TOAST_MS,
        actions: [
          {
            label: "Undo",
            onAction: () => {
              undoAiRequest(client, requestId).then(
                (s) => toast(s),
                (e: Error) => toast(e.message, { tone: "error" }),
              );
            },
          },
          ...(canSuggest && req
            ? [{ label: "Show options", onAction: () => showOptions(req) }]
            : []),
        ],
      });
    },
    [client, showOptions],
  );

  // Each Do runs on its own, so its toast's Cancel stops only that one.
  const runDo = useCallback(
    async (req: AiRunRequest) => {
      closeBar();
      const provider = req.provider ?? defaultProvider ?? "openrouter";
      const handle = startAiRequest(client, req, defaultProvider);
      const key = toast(`${PROVIDER_NAMES[provider]} is working…`, {
        timeout: 0,
        actions: [{ label: "Cancel", onAction: handle.cancel }],
      });
      const done = await handle.done;
      closeToast(key);
      if (done.result?.status === "applied") {
        showApplied(done.result.requestId, done.result.summary, req);
      } else if (done.phase === "error") {
        showError(done);
      }
    },
    [closeBar, defaultProvider, client, showApplied, showError],
  );

  const runRequest = useCallback(
    (req: AiRunRequest) => {
      if (req.kind === "do") void runDo(req);
      else void bar.run(req);
    },
    [runDo, bar],
  );
  retryRef.current = runRequest;

  const pickOption = useCallback(
    async (option: number) => {
      const done = await bar.apply(option);
      if (done.result?.status === "applied") {
        closeBar();
        showApplied(done.result.requestId, done.result.summary, done.request);
      }
    },
    [bar, closeBar, showApplied],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!showRow || !action || !kind || !interp) return false;
    const { phase, result } = bar.state;
    if (phase === "suggested" && result?.status === "suggested") {
      const n = Number(e.key);
      if (
        Number.isInteger(n) &&
        n >= 1 &&
        n <= 3 &&
        n <= result.options.length
      ) {
        e.preventDefault();
        void pickOption(n - 1);
        return true;
      }
    }
    const by = e.shiftKey ? -1 : 1;
    // Tab switches kind only while nothing is shown below; otherwise it moves
    // focus to the result's controls as usual.
    if (e.key === "Tab" && kinds.length > 1 && phase === "idle") {
      // The dialog's focus scope moves focus on Tab even when prevented.
      e.preventDefault();
      e.stopPropagation();
      setChoice({
        text: query,
        actionId: action.id,
        kind: step(kinds, kind, by),
      });
      return true;
    }
    if (
      (e.key === "ArrowDown" || e.key === "ArrowUp") &&
      candidates.length > 1 &&
      candidate
    ) {
      e.preventDefault();
      bar.discard();
      const next = step(candidates, candidate, e.key === "ArrowDown" ? 1 : -1);
      setChoice({ text: query, actionId: next.actionId, kind: null });
      return true;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      // Wait for the guess about the text as it is now.
      if (interpCurrent && phase !== "working" && phase !== "suggested") {
        runRequest({
          text: query,
          itemId,
          actionId: action.id,
          kind,
          interpretedBy: interp.source,
        });
      }
      return true;
    }
    return false;
  };

  const onQueryChange = (q: string) => {
    if (bar.state.phase !== "idle") bar.discard();
    setQuery(q);
  };

  const onOpenChange = (next: boolean) => {
    if (!next) bar.discard();
    setOpen(next);
  };

  const providerName = defaultProvider
    ? PROVIDER_NAMES[defaultProvider]
    : undefined;
  const { state } = bar;
  const result =
    open && state.phase !== "idle" && state.phase !== "applied" ? (
      <AiResult
        state={state}
        providerName={PROVIDER_NAMES[state.provider ?? "openrouter"]}
        errorActions={
          state.error && state.request && state.provider
            ? errorActions(state.error, state.request, state.provider, {
                retry: runRequest,
                openSettings: () => {
                  closeBar();
                  navigate("/settings");
                },
              })
            : []
        }
        onUse={(i) => void pickOption(i)}
        onNone={closeBar}
        onCancel={bar.cancel}
        onClose={closeBar}
      />
    ) : undefined;

  return {
    interpretation:
      showRow && action && kind && interp ? (
        <UnderstoodAs
          action={action}
          kind={kind}
          confidence={interp.confidence}
          providerName={providerName}
          onKindChange={(k) => {
            bar.discard();
            setChoice({ text: query, actionId: action.id, kind: k });
          }}
        />
      ) : undefined,
    result,
    footer: showRow ? (
      <AiFooter alternatives={candidates.length > 1} />
    ) : undefined,
    onKeyDown,
    onQueryChange,
    onOpenChange,
  };
}

function AiFooter({ alternatives }: { alternatives: boolean }) {
  return (
    <>
      <span className="flex items-center gap-1.5">
        <Kbd keys={["↵"]} /> to run
      </span>
      <span className="flex items-center gap-1.5">
        <Kbd keys={["tab"]} /> to switch kind
      </span>
      {alternatives ? (
        <span className="flex items-center gap-1.5">
          <Kbd keys={["↑↓"]} /> for other actions
        </span>
      ) : null}
      <span className="flex items-center gap-1.5">
        <Kbd keys={["esc"]} /> to close
      </span>
    </>
  );
}
