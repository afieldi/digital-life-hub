import { Button, Kbd, toast } from "@dlh/ui";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-aria-components";
import { useTRPC } from "../api/client";
import { registry } from "../modules";
import type { AiAction } from "./errorActions";
import type { AiUiState } from "./useAiRequest";

const linkClass =
  "rounded-10 border border-white/14 bg-white/8 px-3 py-1 text-xs text-ink-secondary hover:brightness-125";

/** The items an answer relied on, as links to their pages. Deleted ones are left out. */
function UsedItems({ ids, onOpen }: { ids: string[]; onOpen: () => void }) {
  const trpc = useTRPC();
  const items = useQueries({
    queries: ids.map((id) => ({
      ...trpc.items.get.queryOptions({ id }),
      retry: false,
    })),
  });
  const links = items.flatMap((q) => {
    const item = q.data;
    const type = item && registry.itemTypes.get(item.type);
    return item && type
      ? [{ id: item.id, title: item.title, href: type.href(item.id) }]
      : [];
  });
  if (links.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-ink-tertiary">Used</span>
      {links.map((l) => (
        <Link key={l.id} href={l.href} onPress={onOpen} className={linkClass}>
          {l.title}
        </Link>
      ))}
    </div>
  );
}

/**
 * The command bar's result slot for an AI request: progress, an answer,
 * options to pick from, or an error with what it offers.
 */
export function AiResult({
  state,
  providerName,
  errorActions,
  onUse,
  onNone,
  onCancel,
  onClose,
}: {
  state: AiUiState;
  providerName: string;
  errorActions: AiAction[];
  onUse: (option: number) => void;
  onNone: () => void;
  onCancel: () => void;
  /** Called when a link leaves the bar. */
  onClose: () => void;
}) {
  const { result } = state;
  if (state.phase === "working") {
    return (
      <div className="flex items-center gap-3">
        <span className="flex-1 text-ink-secondary">
          {providerName} is working…
        </span>
        <Button variant="ghost" onPress={onCancel}>
          Cancel
        </Button>
      </div>
    );
  }
  if (state.phase === "error" && state.error) {
    return (
      <div className="flex flex-col gap-3">
        <p>{state.error.message}</p>
        {errorActions.length > 0 ? (
          <div className="flex gap-2">
            {errorActions.map((a) => (
              <Button key={a.label} variant="glass" onPress={a.onAction}>
                {a.label}
              </Button>
            ))}
          </div>
        ) : null}
      </div>
    );
  }
  if (result?.status === "answered") {
    return (
      <div className="flex flex-col gap-3">
        <p className="whitespace-pre-wrap">{result.answer}</p>
        <UsedItems ids={result.used} onOpen={onClose} />
        <div>
          <Button
            variant="ghost"
            onPress={() => {
              navigator.clipboard?.writeText(result.answer).then(
                () => toast("Copied"),
                () => toast("Could not copy", { tone: "error" }),
              );
            }}
          >
            Copy
          </Button>
        </div>
      </div>
    );
  }
  if (result?.status === "suggested") {
    return (
      <div className="flex flex-col gap-1">
        <ol className="flex flex-col gap-1">
          {result.options.map((o, i) => (
            <li
              // biome-ignore lint/suspicious/noArrayIndexKey: options are fixed per result
              key={i}
              className="flex items-center gap-3 rounded-14 px-1 py-1"
            >
              {i < 3 ? <Kbd keys={[String(i + 1)]} /> : null}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{o.label}</span>
                {o.reason ? (
                  <span className="text-xs text-ink-tertiary">{o.reason}</span>
                ) : null}
              </div>
              <Button
                variant="glass"
                aria-label={`Use ${o.label}`}
                onPress={() => onUse(i)}
              >
                Use
              </Button>
            </li>
          ))}
        </ol>
        <div>
          <Button variant="ghost" onPress={onNone}>
            None of these
          </Button>
        </div>
      </div>
    );
  }
  return null;
}
