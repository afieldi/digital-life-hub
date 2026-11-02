import { useOpenItem } from "@dlh/client";
import {
  type ItemSummary,
  type ModuleRegistry,
  type OperationDescription,
  type OperationList,
  operationList,
  type PaletteContext,
} from "@dlh/core";
import {
  type CommandGroup,
  type CommandItem,
  OperationForm,
  toast,
} from "@dlh/ui";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createElement,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTRPC, useTRPCClient } from "../api/client";
import {
  callOperation,
  isConflict,
  type UndoToken,
  undoOperation,
} from "./call";
import { ListResult } from "./ListResult";
import {
  type OperationGroupId,
  type OperationPlan,
  operationRow,
  operationRows,
  operationText,
  planOperation,
} from "./rows";

const UNDO_TOAST_MS = 10_000;

const deviceTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

const GROUP_LABELS: Record<OperationGroupId, string> = {
  create: "Create",
  actions: "Actions",
};

type FormState = {
  op: OperationDescription;
  plan: Extract<OperationPlan, { status: "form" }>;
};

/** A read's result, for the query it was run on. */
type ListState = {
  query: string;
  list: OperationList | null;
};

/** A failed call: a conflict says what the server said; anything else is an error. */
function showError(err: unknown, fallback: string) {
  if (isConflict(err)) toast(err.message);
  else toast(fallback, { tone: "error" });
}

/**
 * Module operations in ⌘K. `rows` are the operation rows for the bar's own
 * list. Choosing one runs it when its input is ready, opens its form when
 * there is one, or enters its step: the bar then lists only that operation
 * (`groups`), ↵ runs it, ⌘↵ asks AI with it chosen (`active` is passed on as
 * the forced action) and Esc leaves the step. Mutations toast with Undo; reads
 * show their list in the `result` slot.
 */
export function useOperationStep({
  registry,
  open,
  setOpen,
  query,
  navigate,
}: {
  registry: Pick<ModuleRegistry, "operations" | "itemTypes">;
  open: boolean;
  setOpen: (open: boolean) => void;
  query: string;
  navigate: (to: string) => void;
}): {
  /** The operation whose step the bar is in. */
  active?: OperationDescription;
  rows: Record<OperationGroupId, CommandItem[]>;
  /** The bar's groups while in a step. */
  groups?: CommandGroup[];
  result?: ReactNode;
  /** The operation's form, rendered by the caller outside the bar. */
  form?: ReactNode;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => boolean;
} {
  const trpc = useTRPC();
  const client = useTRPCClient();
  const queryClient = useQueryClient();
  const openItemId = useOpenItem();
  const openItem = useQuery({
    ...trpc.items.get.queryOptions(openItemId ? { id: openItemId } : skipToken),
    enabled: open && openItemId !== null,
    retry: false,
  });

  const [active, setActive] = useState<OperationDescription | null>(null);
  const [listed, setListed] = useState<ListState | null>(null);
  const [form, setForm] = useState<FormState | null>(null);

  useEffect(() => {
    if (open) return;
    setActive(null);
    setListed(null);
  }, [open]);

  // Unknown while the open item loads; a missing item counts as none.
  const known = openItemId === null || openItem.isError || !!openItem.data;
  const item =
    openItemId !== null && openItem.data
      ? {
          id: openItem.data.id,
          type: openItem.data.type,
          updatedAt: openItem.data.updatedAt,
        }
      : undefined;
  const baseCtx = (): Omit<PaletteContext, "text"> => ({
    ...(item ? { item } : {}),
    now: new Date(),
    timeZone: deviceTimeZone(),
  });

  const runMutation = useCallback(
    async (op: OperationDescription, input: unknown) => {
      setOpen(false);
      try {
        const { undo } = (await callOperation(client, op, input)) as {
          undo: UndoToken;
        };
        // The item on screen has a new version for the next write.
        void queryClient.invalidateQueries({ queryKey: trpc.items.pathKey() });
        toast(op.summary(input as never), {
          tone: "success",
          timeout: UNDO_TOAST_MS,
          actions: [
            {
              label: "Undo",
              onAction: () => {
                undoOperation(client, op.id, undo).then(
                  (summary) => {
                    void queryClient.invalidateQueries({
                      queryKey: trpc.items.pathKey(),
                    });
                    toast(summary);
                  },
                  (err) => showError(err, "Couldn't undo"),
                );
              },
            },
          ],
        });
      } catch (err) {
        showError(err, `Couldn't ${op.label.toLowerCase()}`);
      }
    },
    [client, queryClient, setOpen, trpc],
  );

  const runQuery = useCallback(
    async (op: OperationDescription, input: unknown, onQuery: string) => {
      setActive(op);
      setListed({ query: onQuery, list: null });
      try {
        const list = operationList.parse(
          await callOperation(client, op, input),
        );
        setListed((s) => (s?.query === onQuery ? { ...s, list } : s));
      } catch (err) {
        setListed(null);
        showError(err, `Couldn't load ${op.label.toLowerCase()}`);
      }
    },
    [client],
  );

  const run = (op: OperationDescription, input: unknown) => {
    if (op.kind === "query") void runQuery(op, input, query);
    else void runMutation(op, input);
  };

  const openForm = async (
    op: OperationDescription,
    plan: FormState["plan"],
  ) => {
    setOpen(false);
    // An item field shows its title, so look up the ids the form starts with.
    const initial = { ...plan.initial };
    for (const f of plan.fields) {
      const id = initial[f.name];
      if (f.kind !== "item" || typeof id !== "string") continue;
      try {
        const found = await client.items.get.query({ id });
        initial[f.name] = {
          id: found.id,
          type: found.type,
          title: found.title,
          archivedAt: found.archivedAt,
        } satisfies ItemSummary;
      } catch {
        // Left as the bare id: the field shows empty until another is picked.
      }
    }
    setForm({ op, plan: { ...plan, initial } });
  };

  /** ↵ on an operation: run it, ask with its form, or wait in its step. */
  const choose = (op: OperationDescription, ctx: PaletteContext) => {
    const plan = planOperation(op, ctx);
    if (plan.status === "ready") run(op, plan.input);
    else if (plan.status === "form") void openForm(op, plan);
    else {
      setListed(null);
      setActive(op);
    }
  };

  // Rows are memoized for the Shell's groups; they call the current `choose`.
  const chooseRef = useRef(choose);
  chooseRef.current = choose;
  const { id: itemId, type: itemType, updatedAt } = item ?? {};
  const rows = useMemo(() => {
    if (!open || !known || active) return { create: [], actions: [] };
    const ctx = {
      ...(itemId && itemType && updatedAt
        ? { item: { id: itemId, type: itemType, updatedAt } }
        : {}),
      now: new Date(),
      timeZone: deviceTimeZone(),
    };
    return operationRows(registry.operations, ctx, query, (op, c) =>
      chooseRef.current(op, c),
    );
  }, [
    open,
    known,
    active,
    itemId,
    itemType,
    updatedAt,
    query,
    registry.operations,
  ]);

  let groups: CommandGroup[] | undefined;
  if (active) {
    const ctx = {
      ...baseCtx(),
      text: operationText(active, query) ?? query.trim(),
    };
    const plan = planOperation(active, ctx);
    const group = active.group ?? "actions";
    groups = [
      {
        id: group,
        label: GROUP_LABELS[group],
        items: [
          operationRow(active, plan, () => choose(active, ctx), {
            // Nothing for ↵ to do: ⌘↵ (or ↵) asks AI instead.
            disabled: plan.status === "waiting",
          }),
        ],
      },
    ];
  }

  const shownList = listed?.query === query ? listed : null;
  const result = shownList
    ? shownList.list
      ? createElement(ListResult, {
          list: shownList.list,
          itemTypes: registry.itemTypes,
          onOpen: (href: string) => {
            setOpen(false);
            navigate(href);
          },
        })
      : createElement("p", { className: "text-ink-tertiary" }, "Loading…")
    : undefined;

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!active || e.key !== "Escape") return false;
    // Esc leaves the step; the bar stays open on the same text.
    e.preventDefault();
    e.stopPropagation();
    setActive(null);
    setListed(null);
    return true;
  };

  const formNode = form
    ? createElement(OperationForm, {
        title: form.op.label,
        fields: form.plan.fields,
        initial: form.plan.initial,
        timeZone: deviceTimeZone(),
        search: (q: string, types: string[]) =>
          client.search.query({ query: q, types }),
        onSubmit: (values: Record<string, unknown>) => {
          const { op, plan } = form;
          setForm(null);
          let input: unknown;
          try {
            input = plan.toInput(values);
          } catch {
            toast(`Couldn't ${op.label.toLowerCase()}`, { tone: "error" });
            return;
          }
          if (op.kind === "query") {
            // The list shows in the bar, so it opens again on the same text.
            setOpen(true);
          }
          run(op, input);
        },
        onCancel: () => setForm(null),
      })
    : undefined;

  return {
    ...(active ? { active } : {}),
    rows,
    ...(groups ? { groups } : {}),
    ...(result ? { result } : {}),
    ...(formNode ? { form: formNode } : {}),
    onKeyDown,
  };
}
