import { UNDO_TOAST_MS, useOpenItem } from "@dlh/client";
import {
  deviceTimeZone,
  formFields,
  type ItemSummary,
  type ModuleRegistry,
  NotReady,
  type OperationDescription,
  type OperationList,
  operationList,
  type PaletteContext,
  type PaletteRead,
} from "@dlh/core";
import {
  type CommandGroup,
  type CommandItem,
  OperationForm,
  toast,
} from "@dlh/ui";
import {
  skipToken,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
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
import { callOperation, hasUndo, isConflict, undoOperation } from "./call";
import { ListResult } from "./ListResult";
import {
  appliesTo,
  type Loaded,
  needsLoad,
  type OperationGroupId,
  type OperationPlan,
  operationRow,
  operationRows,
  operationText,
  planOperation,
} from "./rows";

/** Query keys for palette `load`s; every write refreshes them. */
const LOAD_KEY = ["palette-load"] as const;

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
 * Refetches what ⌘K reads of items after a write: the open item (its version
 * for the next write) and palette loads. Screens call it through
 * `ShellApi.itemsChanged`, so ⌘K never acts on a version from before them.
 */
export function useRefreshItems(): () => void {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: trpc.items.pathKey(),
      refetchType: "all",
    });
    void queryClient.invalidateQueries({ queryKey: LOAD_KEY });
  }, [queryClient, trpc]);
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

  // Unknown while the open item loads, or refetches after a write said its
  // version is old; a missing item counts as none.
  const invalidated =
    openItemId !== null &&
    openItem.isFetching &&
    queryClient.getQueryState(trpc.items.get.queryKey({ id: openItemId }))
      ?.isInvalidated === true;
  const known =
    openItemId === null ||
    openItem.isError ||
    (!!openItem.data && !invalidated);
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

  const read = useCallback<PaletteRead>(
    (operationId, input) => {
      const op = registry.operations.find(
        (o) => o.id === operationId && o.kind === "query",
      );
      if (!op) {
        return Promise.reject(new Error(`No query "${operationId}"`));
      }
      return callOperation(client, op, input);
    },
    [client, registry.operations],
  );

  /** Runs `op`'s palette `load`, then looks up the titles of the item fields it filled. */
  const loadFor = useCallback(
    async (
      op: OperationDescription,
      ctx: Omit<PaletteContext, "text">,
    ): Promise<Loaded> => {
      const spec = op.palette;
      if (typeof spec !== "object" || !spec.load) {
        return { values: {}, titles: {} };
      }
      const values = await spec.load({ ...ctx, text: "" }, read);
      const titles: Record<string, string> = {};
      for (const f of formFields(spec.params)) {
        const id = values[f.name];
        if (f.kind !== "item" || typeof id !== "string") continue;
        titles[f.name] = (await client.items.get.query({ id })).title;
      }
      return { values, titles };
    },
    [client, read],
  );

  const loadOptions = (
    op: OperationDescription,
    ctx: Omit<PaletteContext, "text">,
  ) => ({
    queryKey: [...LOAD_KEY, op.id, ctx.item?.id, ctx.item?.updatedAt],
    queryFn: () => loadFor(op, ctx),
    retry: false,
  });

  const refresh = useRefreshItems();

  const runMutation = useCallback(
    async (op: OperationDescription, input: unknown, label?: string) => {
      setOpen(false);
      try {
        const res = await callOperation(client, op, input);
        const undo = hasUndo(res) ? res.undo : null;
        refresh();
        toast(label ?? op.summary(input as never), {
          tone: "success",
          timeout: UNDO_TOAST_MS,
          actions: !undo
            ? []
            : [
                {
                  label: "Undo",
                  onAction: () => {
                    undoOperation(client, op.id, undo).then(
                      (summary) => {
                        refresh();
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
    [client, refresh, setOpen],
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

  const run = (op: OperationDescription, input: unknown, label?: string) => {
    if (op.kind === "query") void runQuery(op, input, query);
    else void runMutation(op, input, label);
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

  /** `op`'s load for `ctx`, from the cache or read now; none when it fails. */
  const loadedFor = async (
    op: OperationDescription,
    ctx: PaletteContext,
  ): Promise<Loaded | undefined> => {
    if (!needsLoad(op, ctx)) return undefined;
    try {
      return await queryClient.fetchQuery(loadOptions(op, ctx));
    } catch (e) {
      if (!(e instanceof NotReady))
        console.error(`⌘K: loading ${op.id} failed`, e);
      return undefined;
    }
  };

  /** ↵ on an operation: run it, ask with its form, or wait in its step. */
  const choose = async (op: OperationDescription, ctx: PaletteContext) => {
    const plan = planOperation(op, ctx, await loadedFor(op, ctx));
    if (plan.status === "ready") run(op, plan.input, plan.label);
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
  // Loads for the operations that apply to the item on screen, so their rows
  // can show what ↵ will do.
  const loadable =
    open && item
      ? registry.operations.filter(
          (op) => appliesTo(op, item.type) && needsLoad(op, baseCtx()),
        )
      : [];
  const loads = useQueries({
    queries: loadable.map((op) => loadOptions(op, baseCtx())),
  });
  const loadedKey = loads.map((l) => l.dataUpdatedAt).join();
  // biome-ignore lint/correctness/useExhaustiveDependencies: `loadedKey` changes exactly when a load's data does.
  const loaded = useMemo(() => {
    const out: Record<string, Loaded> = {};
    loadable.forEach((op, n) => {
      const data = loads[n]?.data;
      if (data) out[op.id] = data;
    });
    return out;
  }, [loadedKey, loadable.map((op) => op.id).join()]);
  const rows = useMemo(() => {
    if (!open || !known || active) return { create: [], actions: [] };
    const ctx = {
      ...(itemId && itemType && updatedAt
        ? { item: { id: itemId, type: itemType, updatedAt } }
        : {}),
      now: new Date(),
      timeZone: deviceTimeZone(),
    };
    return operationRows(
      registry.operations,
      ctx,
      query,
      (op, c) => void chooseRef.current(op, c),
      loaded,
    );
  }, [
    loaded,
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
    const match = operationText(active, query);
    const ctx: PaletteContext = {
      ...baseCtx(),
      text: match?.text ?? query.trim(),
      ...(match ? { name: match.name } : {}),
    };
    const plan = planOperation(active, ctx, loaded[active.id]);
    const group = active.group ?? "actions";
    groups = [
      {
        id: group,
        label: GROUP_LABELS[group],
        items: [
          operationRow(active, plan, () => void choose(active, ctx), {
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
          } catch (e) {
            const why = firstIssue(e);
            if (!why && !(e instanceof NotReady)) {
              console.error(`⌘K: ${op.id} input failed`, e);
            }
            toast(
              `Couldn't ${op.label.toLowerCase()}${why ? `: ${why}` : ""}`,
              {
                tone: "error",
              },
            );
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

/** The first message of a zod validation error, if `e` is one. */
function firstIssue(e: unknown): string | undefined {
  if (!(e instanceof Error) || e.name !== "ZodError" || !("issues" in e)) {
    return undefined;
  }
  const [first] = Array.isArray(e.issues) ? e.issues : [];
  return typeof first?.message === "string" ? first.message : undefined;
}
