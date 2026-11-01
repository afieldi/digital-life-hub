import {
  AI_KIND_ORDER,
  type AiActionDescription,
  type AiKind,
  capFor,
  NOT_SURE_BELOW,
} from "@dlh/core";
import { TypeTile } from "@dlh/ui";

export const KIND_LABELS: Record<AiKind, string> = {
  ask: "Ask",
  suggest: "Suggest",
  do: "Do",
};

const KIND_LINES: Record<AiKind, string> = {
  ask: "Answers only, changes nothing",
  suggest: "Shows options, changes nothing until you pick",
  do: "Changes it now, with Undo after",
};

const rank = (k: AiKind) => AI_KIND_ORDER.indexOf(k);

/** The kinds this action may run as: its own, up to its cap, least autonomous first. */
export function allowedKinds(action: AiActionDescription): AiKind[] {
  const cap = rank(capFor(action.effects));
  return AI_KIND_ORDER.filter(
    (k) => action.kinds.includes(k) && rank(k) <= cap,
  );
}

/**
 * What running as `kind` does. A deleting action is capped below Do, so its
 * line says why it never applies directly.
 */
export function kindLine(action: AiActionDescription, kind: AiKind): string {
  const capped = rank(capFor(action.effects)) < rank("do");
  if (capped && kind !== "ask" && action.effects.includes("deleteItems")) {
    return "Deletes always show you first";
  }
  return KIND_LINES[kind];
}

/** The command bar's Understood as row: action, kind switch, what it will do and who runs it. */
export function UnderstoodAs({
  action,
  kind,
  confidence,
  providerName,
  onKindChange,
}: {
  action: AiActionDescription;
  kind: AiKind;
  confidence: number;
  /** Omitted until the AI settings have loaded. */
  providerName?: string;
  onKindChange: (kind: AiKind) => void;
}) {
  const line = kindLine(action, kind);
  return (
    <div className="flex items-center gap-3">
      <TypeTile type="ai" size={30} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2 text-sm">
          <span className="text-ink-tertiary">Understood as</span>
          <span className="truncate font-semibold text-ink-primary">
            {action.label}
          </span>
          {confidence < NOT_SURE_BELOW ? (
            <span className="rounded-full border border-white/14 bg-white/8 px-2 text-xs text-ink-secondary">
              Not sure
            </span>
          ) : null}
        </div>
        <span className="truncate text-xs text-ink-tertiary">
          {providerName ? `${line} · ${providerName}` : line}
        </span>
      </div>
      <div
        role="radiogroup"
        aria-label="Kind"
        className="flex shrink-0 rounded-14 border border-white/14 bg-white/6 p-0.5"
      >
        {allowedKinds(action).map((k) => (
          // A segmented switch of buttons that never take focus from the bar's input.
          // biome-ignore lint/a11y/useSemanticElements: styled radio buttons; keys are handled by the input
          <button
            key={k}
            type="button"
            role="radio"
            aria-checked={k === kind}
            // Keep focus in the command bar's input.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onKindChange(k)}
            className={`min-h-9 rounded-[12px] px-3 font-ui text-sm ${
              k === kind
                ? "bg-white/16 text-ink-primary"
                : "text-ink-tertiary hover:text-ink-secondary"
            }`}
          >
            {KIND_LABELS[k]}
          </button>
        ))}
      </div>
    </div>
  );
}
