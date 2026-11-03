import { useGoChordPending, useItemHref } from "@dlh/client";
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

export type OpenRowHandlers = {
  /** `refocus`: where focus goes once the task is made and the row leaves. */
  onMakeTask: (row: RequestRow, refocus?: HTMLElement | null) => void;
  /** Resolves to the write's result, or null when it failed. */
  onResolve: (
    row: RequestRow,
    outcome: "handled" | "not_for_me",
  ) => Promise<unknown>;
  /** Resolves to the write's result, or null when it failed. */
  onAction: (row: RequestRow, action: RequestAction) => Promise<unknown>;
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
        onPress={() => void handlers.onAction(row, action)}
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
    button(
      OUTCOME_LABELS.handled,
      () => void handlers.onResolve(row, "handled"),
    ),
    button(
      OUTCOME_LABELS.not_for_me,
      () => void handlers.onResolve(row, "not_for_me"),
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

/** How long a failed write's row has to come back for focus to return to it. */
const REFOCUS_WAIT_MS = 5000;

/**
 * After a write that dropped row `id` failed, focus goes back to the row once
 * the refresh brings it back, unless the person has moved focus on from
 * `movedTo` (where it went when the row left).
 */
function focusWhenBack(id: string, movedTo: HTMLElement) {
  const list = movedTo.closest("[data-request-list]") ?? document;
  const tryFocus = (): boolean => {
    const active = document.activeElement;
    if (active !== movedTo && active !== document.body) return true;
    const link = list.querySelector<HTMLElement>(
      `[data-request-id="${id}"] a[href]`,
    );
    link?.focus();
    return !!link;
  };
  if (tryFocus()) return;
  const observer = new MutationObserver(() => {
    if (tryFocus()) stop();
  });
  const timer = setTimeout(() => stop(), REFOCUS_WAIT_MS);
  const stop = () => {
    observer.disconnect();
    clearTimeout(timer);
  };
  observer.observe(list, { childList: true, subtree: true });
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
  const goChordPending = useGoChordPending();
  const ref = useRef<HTMLDivElement>(null);
  // Resolving drops the row: focus in it moves on first, so the next key acts
  // on the next row rather than falling to the page.
  const refocus = () => {
    const el = ref.current;
    return el?.contains(document.activeElement) ? focusAfter(el) : null;
  };
  // If the write fails, the refresh puts the row back and focus with it.
  const leave = async (write: () => Promise<unknown>) => {
    const movedTo = refocus();
    movedTo?.focus();
    const result = await write();
    if (result === null && movedTo) focusWhenBack(row.id, movedTo);
    return result;
  };
  const leaving: OpenRowHandlers = {
    onMakeTask: (r) => handlers.onMakeTask(r, refocus()),
    onResolve: (r, outcome) => leave(() => handlers.onResolve(r, outcome)),
    onAction: (r, action) => leave(() => handlers.onAction(r, action)),
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    // The key after `g` is the shell's "go to" chord.
    if (goChordPending() || hasActions) return;
    const key = e.key.toLowerCase();
    if (key === "t") leaving.onMakeTask(row);
    else if (key === "h") void leaving.onResolve(row, "handled");
    else if (key === "n") void leaving.onResolve(row, "not_for_me");
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
