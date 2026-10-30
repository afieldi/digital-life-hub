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
import { Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { House, Settings as SettingsIcon } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { RouterProvider } from "react-aria-components";
import { registry } from "../modules";
import { createHotkeys } from "./hotkeys";
import { iconFor } from "./icons";
import {
  loadSceneOverride,
  SceneOverrideContext,
  saveSceneOverride,
} from "./sceneOverride";

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

  const groups = useMemo<CommandGroup[]>(() => {
    if (!commandOpen) return [];
    const ctx: CommandContext = { pathname, navigate };
    const available = registry.actions.filter((a) => !a.when || a.when(ctx));
    return (["create", "actions", "ai"] as const).map((id) => ({
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
            hint: a.shortcut,
            onAction: () => {
              void a.run(ctx);
            },
          };
        }),
    }));
  }, [commandOpen, pathname, navigate]);

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
          onOpenChange={setCommandOpen}
          query={query}
          onQueryChange={setQuery}
          groups={groups}
        />
        <ToastRegion />
      </SceneOverrideContext>
    </RouterProvider>
  );
}
