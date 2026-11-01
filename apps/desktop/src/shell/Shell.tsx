import type { CommandContext, PaletteAction } from "@dlh/core";
import {
  Button,
  CommandBar,
  type CommandGroup,
  Dock,
  type DockItem,
  Kbd,
  Scene,
  type SceneVariant,
  ToastRegion,
} from "@dlh/ui";
import { useQuery } from "@tanstack/react-query";
import { Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { House, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RouterProvider } from "react-aria-components";
import { useAskAi } from "../ai/useAskAi";
import { useTRPC } from "../api/client";
import { registry } from "../modules";
import { createHotkeys } from "./hotkeys";
import { iconFor } from "./icons";
import { goToRows, itemRows, jumpGroup, matchesQuery } from "./palette";
import {
  loadSceneOverride,
  SceneOverrideContext,
  saveSceneOverride,
} from "./sceneOverride";
import { useDebouncedValue } from "./useDebouncedValue";

const SEARCH_DEBOUNCE_MS = 150;

const GROUP_LABELS: Record<PaletteAction["group"], string> = {
  create: "Create",
  actions: "Actions",
  ai: "AI",
};

/** `g` + letter targets: Home is `g h`; modules declare their own `nav.key`. */
const goTargets = new Map<string, string>([
  ["h", "/"],
  ...registry.nav.flatMap((n) =>
    n.key ? [[n.key, n.path] as [string, string]] : [],
  ),
]);

const dockItems: DockItem[] = [
  { id: "home", label: "Home", icon: House, href: "/" },
  ...registry.nav.map((n) => ({
    id: n.path,
    label: n.label,
    icon: iconFor(n.icon),
    href: n.path,
  })),
  { id: "settings", label: "Settings", icon: SettingsIcon, href: "/settings" },
];

/** The dock item that owns the current path (longest matching prefix). */
function currentDockHref(pathname: string): string {
  let best = "";
  for (const { href } of dockItems) {
    const owns =
      href === "/"
        ? pathname === "/"
        : pathname === href || pathname.startsWith(`${href}/`);
    if (owns && href.length > best.length) best = href;
  }
  return best;
}

function platform(): string {
  if (typeof navigator === "undefined") return "";
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  return nav.userAgentData?.platform || nav.platform || "";
}

export function Shell() {
  const router = useRouter();
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  const [override, setOverrideState] = useState<SceneVariant | null>(
    loadSceneOverride,
  );
  const setOverride = useCallback((value: SceneVariant | null) => {
    saveSceneOverride(value);
    setOverrideState(value);
  }, []);
  const sceneState = useMemo(
    () => ({ override, setOverride }),
    [override, setOverride],
  );

  const [commandOpen, setCommandOpen] = useState(false);
  const [query, setQuery] = useState("");
  const openCommandBar = useCallback(() => {
    setQuery("");
    setCommandOpen(true);
  }, []);

  const navigate = useCallback(
    (to: string) => {
      router.navigate({ to });
    },
    [router],
  );

  useEffect(() => {
    const onKeyDown = createHotkeys({
      platform: platform(),
      onCommandBar: openCommandBar,
      onGo: (key) => {
        const to = goTargets.get(key);
        if (to) navigate(to);
      },
    });
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [navigate, openCommandBar]);

  const trpc = useTRPC();
  const emptyQuery = query.trim() === "";
  const debouncedQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS);
  const searching = commandOpen && debouncedQuery.trim() !== "";
  // The query key includes the text, so a slow response for an old query can
  // never replace the results for the current one.
  const search = useQuery({
    ...trpc.search.queryOptions({ query: debouncedQuery }),
    enabled: searching,
    retry: false,
  });
  const recents = useQuery({
    ...trpc.recents.list.queryOptions(),
    enabled: commandOpen && emptyQuery,
  });

  const groups = useMemo<CommandGroup[]>(() => {
    if (!commandOpen) return [];
    const ctx: CommandContext = { pathname, navigate };
    const available = registry.actions.filter(
      (a) =>
        (!a.when || a.when(ctx)) &&
        matchesQuery(
          typeof a.label === "function" ? a.label(ctx) : a.label,
          a.keywords,
          query,
        ),
    );
    const actionGroups = (["create", "actions", "ai"] as const).map((id) => ({
      id,
      label: GROUP_LABELS[id],
      items: available
        .filter((a) => a.group === id)
        .map((a) => {
          const Icon = a.icon ? iconFor(a.icon) : null;
          return {
            id: a.id,
            label: typeof a.label === "function" ? a.label(ctx) : a.label,
            icon: Icon ? <Icon aria-hidden="true" size={18} /> : undefined,
            onAction: () => {
              void a.run(ctx);
            },
          };
        }),
    }));
    const result: CommandGroup[] = [...actionGroups];
    if (emptyQuery) {
      result.push(
        {
          id: "recent",
          label: "Recents",
          items: itemRows(recents.data ?? [], registry.itemTypes, navigate),
        },
        { id: "goto", label: "Go to", items: goToRows(registry.nav, navigate) },
      );
    } else {
      const jump = jumpGroup({
        status: !searching
          ? "idle"
          : search.isError
            ? "error"
            : search.isSuccess
              ? "ok"
              : "loading",
        items: itemRows(search.data ?? [], registry.itemTypes, navigate),
      });
      if (jump) result.push(jump);
    }
    return result;
  }, [
    commandOpen,
    pathname,
    navigate,
    query,
    emptyQuery,
    searching,
    search.isError,
    search.isSuccess,
    search.data,
    recents.data,
  ]);

  const ai = useAskAi({
    open: commandOpen,
    setOpen: setCommandOpen,
    query,
    setQuery,
    navigate,
    hasRows: groups.some((g) => g.items.some((i) => !i.disabled)),
  });

  return (
    <RouterProvider
      navigate={(to) => navigate(to)}
      useHref={(to) => router.buildLocation({ to }).href}
    >
      <SceneOverrideContext value={sceneState}>
        <Scene variant={override ?? undefined} />
        <main className="min-h-screen pb-32">
          <Outlet />
        </main>
        <Dock
          items={dockItems}
          currentHref={currentDockHref(pathname)}
          className="fixed z-40"
          trailing={
            <Button
              variant="icon"
              aria-label="Command bar"
              className="w-auto px-2"
              onPress={openCommandBar}
            >
              <Kbd keys={["mod", "K"]} />
            </Button>
          }
        />
        <CommandBar
          isOpen={commandOpen}
          onOpenChange={ai.onOpenChange}
          query={query}
          onQueryChange={ai.onQueryChange}
          groups={groups}
          interpretation={ai.interpretation}
          result={ai.result}
          footer={ai.footer}
          onKeyDown={ai.onKeyDown}
        />
        <ToastRegion />
      </SceneOverrideContext>
    </RouterProvider>
  );
}
