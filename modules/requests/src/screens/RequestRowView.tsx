import { useItemHref } from "@dlh/client";
import { Button, Chip, ItemRow } from "@dlh/ui";
import {
  Bot,
  type LucideIcon,
  MessageSquare,
  PenLine,
  Sparkles,
} from "lucide-react";
import { type KeyboardEvent, type ReactNode, useRef } from "react";
import { ageLabel } from "../age";
import type { Outcome, RequestAction, RequestRow, Source } from "../schema";
import { requestHref } from "./api";

const SOURCES: Record<Source, { icon: LucideIcon; label: string }> = {
  manual: { icon: PenLine, label: "Filed by you" },
  ai: { icon: Sparkles, label: "Filed by AI" },
  slack: { icon: MessageSquare, label: "From Slack" },
  agent: { icon: Bot, label: "From an agent" },
};

export const OUTCOME_LABELS: Record<Outcome, string> = {
  task: "Task",
  handled: "Handled",
  not_for_me: "Not for me",
};

/** Who it is from: the sender's name, or "You" for one filed by hand. */
export const senderOf = (row: RequestRow) => row.fromName ?? "You";

/** The source's glyph, named for screen readers. */
export function SourceGlyph({ source }: { source: Source }) {
  const { icon: Icon, label } = SOURCES[source];
  return <Icon role="img" aria-label={label} size={18} strokeWidth={1.75} />;
}

/** `g` starts the shell's "go to" chord; the key after it is the shell's. */
const GO_CHORD_MS = 1000;
let gAt = 0;

export type OpenRowHandlers = {
  /** `refocus`: where focus goes once the task is made and the row leaves. */
  onMakeTask: (row: RequestRow, refocus?: HTMLElement | null) => void;
  onResolve: (row: RequestRow, outcome: "handled" | "not_for_me") => void;
  onAction: (row: RequestRow, action: RequestAction) => void;
};

/**
 * The outcomes, or the request's own actions when it has them. `label`
 * gives each button an accessible name with the row's title.
 */
export function OutcomeButtons({
  row,
  handlers,
  label = (text) => text,
}: {
  row: RequestRow;
  handlers: OpenRowHandlers;
  label?: (text: string) => string;
}) {
  if (row.actions && row.actions.length > 0) {
    return row.actions.map((action) => (
      <Button
        key={action.label}
        variant="ghost"
        aria-label={label(action.label)}
        onPress={() => handlers.onAction(row, action)}
      >
        {action.label}
      </Button>
    ));
  }
  const button = (text: string, onPress: () => void) => (
    <Button
      key={text}
      variant="ghost"
      aria-label={label(text)}
      onPress={onPress}
    >
      {text}
    </Button>
  );
  return [
    button("Make task", () => handlers.onMakeTask(row)),
    button(OUTCOME_LABELS.handled, () => handlers.onResolve(row, "handled")),
    button(OUTCOME_LABELS.not_for_me, () =>
      handlers.onResolve(row, "not_for_me"),
    ),
  ];
}

function Meta({ row }: { row: RequestRow }) {
  const preview = row.body?.split("\n")[0]?.trim();
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      <span className="shrink-0">{senderOf(row)}</span>
      {preview ? (
        <>
          <span aria-hidden="true">·</span>
          <span className="truncate">{preview}</span>
        </>
      ) : null}
    </span>
  );
}

/**
 * Where focus goes when `row` leaves its list: the next row's link, else the
 * previous row's, else the list itself (`data-request-list`, focusable).
 */
function focusAfter(row: HTMLElement): HTMLElement | null {
  const list = row.closest<HTMLElement>("[data-request-list]");
  const rows = [
    ...(list ?? document).querySelectorAll<HTMLElement>("[data-request-id]"),
  ];
  const i = rows.indexOf(row);
  const next = rows[i + 1] ?? rows[i - 1];
  return next?.querySelector<HTMLElement>("a[href]") ?? list;
}

/**
 * An open request: source glyph, sender, title, a line of the body and its
 * age. Its outcomes (or own actions) show on hover or focus; with focus in
 * the row, `t` makes a task, `h` marks it handled and `n` not for me.
 */
export function OpenRequestRow({
  row,
  now,
  handlers,
}: {
  row: RequestRow;
  now: Date;
  handlers: OpenRowHandlers;
}) {
  const hasActions = row.actions !== null && row.actions.length > 0;
  const ref = useRef<HTMLDivElement>(null);
  // Resolving drops the row: focus in it moves on first, so the next key acts
  // on the next row rather than falling to the page.
  const refocus = () => {
    const el = ref.current;
    return el?.contains(document.activeElement) ? focusAfter(el) : null;
  };
  const leaving: OpenRowHandlers = {
    onMakeTask: (r) => handlers.onMakeTask(r, refocus()),
    onResolve: (r, outcome) => {
      refocus()?.focus();
      handlers.onResolve(r, outcome);
    },
    onAction: (r, action) => {
      refocus()?.focus();
      handlers.onAction(r, action);
    },
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    const key = e.key.toLowerCase();
    const afterG = Date.now() - gAt <= GO_CHORD_MS;
    gAt = key === "g" ? Date.now() : 0;
    if (afterG || hasActions) return;
    if (key === "t") leaving.onMakeTask(row);
    else if (key === "h") leaving.onResolve(row, "handled");
    else if (key === "n") leaving.onResolve(row, "not_for_me");
    else return;
    e.preventDefault();
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: keys from the row's own link and buttons bubble here
    <div
      ref={ref}
      data-request-id={row.id}
      className="group"
      onKeyDown={onKeyDown}
    >
      <ItemRow
        leading={<SourceGlyph source={row.source} />}
        title={row.title}
        href={requestHref(row.id)}
        meta={<Meta row={row} />}
        trailing={
          <>
            <span className="invisible flex items-center gap-1 group-focus-within:visible group-hover:visible">
              <OutcomeButtons
                row={row}
                handlers={leaving}
                label={(text) => `${text}: ${row.title}`}
              />
            </span>
            <span>{ageLabel(row.receivedAt, now)}</span>
          </>
        }
      />
    </div>
  );
}

export type ResolvedTask = { id: string; title: string; deleted: boolean };

/** The outcome as a chip; a task outcome links to its task. */
export function OutcomeChip({
  outcome,
  task,
}: {
  outcome: Outcome;
  task: ResolvedTask | null;
}) {
  const itemHref = useItemHref();
  if (outcome !== "task") {
    return <Chip kind="type">{OUTCOME_LABELS[outcome]}</Chip>;
  }
  if (!task) return <Chip kind="type">{OUTCOME_LABELS.task}</Chip>;
  if (task.deleted) return <Chip kind="type">Task deleted</Chip>;
  return (
    <Chip
      kind="type"
      color="var(--color-type-task)"
      href={itemHref({ id: task.id, type: "task" })}
    >
      {task.title}
    </Chip>
  );
}

/** A resolved request: as Open shows it, with its outcome chip and when. */
export function ResolvedRequestRow({
  row,
  task,
  now,
}: {
  row: RequestRow;
  task: ResolvedTask | null;
  now: Date;
}): ReactNode {
  return (
    <div data-request-id={row.id}>
      <ItemRow
        leading={<SourceGlyph source={row.source} />}
        title={row.title}
        href={requestHref(row.id)}
        meta={<Meta row={row} />}
        chips={
          row.outcome ? <OutcomeChip outcome={row.outcome} task={task} /> : null
        }
        trailing={
          row.resolvedAt ? <span>{ageLabel(row.resolvedAt, now)}</span> : null
        }
      />
    </div>
  );
}
