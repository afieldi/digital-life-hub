# Skeleton + UI Library Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A monorepo whose `pnpm dev` opens a Tauri window showing the Dusk shell (time-of-day scene, glass bottom nav built from module manifests, empty Home, Settings, `/dev/ui` gallery), backed by a complete, tested `@dlh/ui` component library.

**Architecture:** pnpm + Turborepo monorepo. `packages/ui` holds Tailwind v4 tokens and React Aria Components styled in the Dusk look, with a gallery that is both the `/dev/ui` route and the Playwright screenshot target (WebKit + Chromium). `packages/core` holds the module contract and registry; `apps/desktop` is a Tauri 2 + Vite + React app whose shell is assembled from module manifests found at build time.

**Tech Stack:** TypeScript (strict), React 19, Vite, Tauri 2, TanStack Router, React Aria Components, Tailwind CSS v4 (+ `tailwindcss-react-aria-components`), Lucide (`lucide-react`), `@fontsource` fonts, Vitest + Testing Library + jsdom, Playwright, Biome, pnpm workspaces, Turborepo, mise.

**Spec:** Core + Shell — Deep-dive Spec, https://claude.ai/artifact/3iKKdVquEJ4Vd3EcA8DUZS (sections: Stack and repo layout, Build and run, App shell, Component library, Milestones → 1. Skeleton). Visual reference: Dusk frames on the Directions canvas, https://claude.ai/artifact/AbLy9Qv5hWYap6JH8ZDHxe.

**Not in this plan (later plans):** API server, Postgres, Docker Compose, sign-in (milestone 2); items, links, search, `/changes`, working ⌘K search (milestone 3); AI gateway (milestone 4).

## Global Constraints

- Platforms: macOS and Windows only. Builds are unsigned in this pass.
- Node 22 LTS and Rust stable, pinned in `mise.toml`.
- TypeScript strict mode everywhere; Biome for lint and format; Vitest for unit tests.
- Package scope `@dlh/*`: `@dlh/ui`, `@dlh/core`, `@dlh/desktop`, `@dlh/module-sample`.
- Modules import UI only from `@dlh/ui`, never `react-aria-components` directly.
- In modules, Tailwind is for layout only (flex, grid, gap, spacing). Colour, glass and type come from `@dlh/ui` components and tokens.
- Icons from Lucide only. Fonts bundled locally via `@fontsource` (no network fetch): Plus Jakarta Sans 400/500/600/700 (UI), Newsreader 400/500 (note bodies).
- Radii tokens: 10, 14, 18, 20, 24 px.
- Item-type colours: task `#9FD9A8`, note `#F5CF7E`, project `#9EC2FF`, event `#F5A8A0`, AI `#CDB6FF`. Status: in progress `#F5CF7E`, review `#9EC2FF`. Checkbox done fill `#A9B8FF`.
- Text levels: primary `#FFFFFF`, secondary `#F4E9EE`, tertiary `#E6DCE4`, muted `#D9CFD6`; link `#FFE2CC`; app background `#1A1724`.
- Scene variants follow local time: morning 05:00–11:59, dusk 17:00–20:59, night 21:00–04:59; 12:00–16:59 reuses morning. Variant changes cross-fade over 60 seconds.
- Every component: behaviour and keyboard tests, plus screenshot tests in WebKit and Chromium.
- Global keys: ⌘K on macOS, Ctrl+K on Windows; Esc closes; `g` then a letter jumps to a module.
- Install dependencies at their latest stable versions at install time; the lockfile records them.

## Review Focus

1. **Clock crosses a boundary while the app is open** (e.g. 16:59 → 17:00): the scene switches to dusk without a reload. Test in Task 4.
2. **Older macOS WebKit**: glass must render on WKWebView versions that only honour `-webkit-backdrop-filter`. Every glass recipe emits both properties. Test in Task 2.
3. **Windows key labels and modifiers**: shortcuts display `Ctrl` not `⌘` on Windows, and Ctrl+K opens the command bar there. Tests in Tasks 8 and 12.
4. **Typing in a field**: `g` + letter shortcuts and ⌘K must not hijack keystrokes while focus is in a text input (⌘K still opens; `g t` does not navigate). Test in Task 12.
5. **Reduced motion and a bad override**: with `prefers-reduced-motion`, scene changes are instant; a corrupt stored time override is ignored and the clock is used. Tests in Tasks 4 and 12.

---

## File structure

```
digital-life-hub/
  package.json  pnpm-workspace.yaml  turbo.json  mise.toml  biome.json
  tsconfig.base.json  .gitignore
  scripts/
    dev.ts                       pnpm dev orchestration (extended in later plans)
    check-module-classes.ts      layout-only Tailwind rule for modules/
    check-module-classes.test.ts
  .github/workflows/ci.yml
  packages/
    ui/
      package.json  vite.config.ts  vitest.config.ts  playwright.config.ts
      src/
        index.ts                 public exports
        theme.css                Tailwind v4 @theme tokens + glass recipes
        tokens.ts                JS mirror of tokens (scenes, type colours)
        platform.ts              isMac(), modKeyLabel()
        scene/  sceneVariant.ts  Scene.tsx  mountains.ts
        glass/  GlassPanel.tsx
        primitives/  Button.tsx Checkbox.tsx TextField.tsx SearchField.tsx Switch.tsx
                     Tabs.tsx Menu.tsx Popover.tsx Dialog.tsx Tooltip.tsx Toast.tsx
                     ComboBox.tsx DatePicker.tsx TimeField.tsx
        dusk/  Dock.tsx TypeTile.tsx Chip.tsx ProgressBar.tsx Breadcrumb.tsx Kbd.tsx
        patterns/  ItemRow.tsx SectionCard.tsx Board.tsx EmptyState.tsx CommandBar.tsx
        gallery/  Gallery.tsx  stories/*.stories.tsx  main.tsx  index.html
      test/      *.test.tsx (one per component group)
      e2e/       screenshots.spec.ts
    core/
      package.json
      src/ index.ts  module.ts  registry.ts
      test/ registry.test.ts
  modules/
    sample/
      package.json
      src/ manifest.tsx  SamplePage.tsx
  apps/
    desktop/
      package.json  vite.config.ts  index.html
      src/ main.tsx  router.tsx  modules.ts  shell/ Shell.tsx  hotkeys.ts  sceneOverride.ts
           routes/ Home.tsx  Settings.tsx  DevUi.tsx
      test/ hotkeys.test.ts  sceneOverride.test.ts  Shell.test.tsx
      e2e/ shell.spec.ts
      src-tauri/  Cargo.toml  tauri.conf.json  src/main.rs  capabilities/default.json
```

---

### Task 1: Repo scaffold and tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `turbo.json`, `mise.toml`, `biome.json`, `tsconfig.base.json`, `.gitignore`

**Interfaces:**
- Produces: root scripts `dev`, `build`, `test`, `lint`, `typecheck`; Turbo tasks `build`, `test`, `typecheck`, `dev` (persistent, uncached); workspace globs `apps/*`, `packages/*`, `modules/*`.

- [ ] **Step 1: Initialise git and the workspace**

Run: `git init && pnpm init`. Write `pnpm-workspace.yaml` with the three globs; `mise.toml` with `node = "22"` and `rust = "stable"`; `tsconfig.base.json` with `strict: true`, `moduleResolution: "bundler"`, `jsx: "react-jsx"`, `target: "ES2022"`; `.gitignore` covering `node_modules`, `dist`, `.turbo`, `src-tauri/target`, `test-results`, `playwright-report`.

- [ ] **Step 2: Add Turbo and Biome**

`pnpm add -Dw turbo @biomejs/biome typescript tsx`. Root scripts: `"dev": "tsx scripts/dev.ts"`, `"build": "turbo run build"`, `"test": "turbo run test"`, `"typecheck": "turbo run typecheck"`, `"lint": "biome check . && tsx scripts/check-module-classes.ts"`. Biome: recommended rules, 2-space indent, and `style/noRestrictedImports` forbidding `react-aria-components` with an override that applies it only to `modules/**`.

- [ ] **Step 3: Verify**

Run: `pnpm biome check .` → Expected: no errors. `pnpm turbo run typecheck` → Expected: "No tasks were executed" (no packages yet), exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "chore: scaffold pnpm + turbo monorepo"
```

---

### Task 2: UI package, tokens and glass recipes

**Files:**
- Create: `packages/ui/package.json`, `packages/ui/vitest.config.ts`, `packages/ui/src/theme.css`, `packages/ui/src/tokens.ts`, `packages/ui/src/index.ts`
- Test: `packages/ui/test/tokens.test.ts`

**Interfaces:**
- Produces:
  - `type ItemType = 'task' | 'note' | 'project' | 'event' | 'ai'`
  - `type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done'`
  - `const typeColors: Record<ItemType, string>`, `const statusColors: Record<'in_progress' | 'review', string>`
  - `theme.css` exporting Tailwind theme vars `--color-type-{task,note,project,event,ai}`, `--color-status-{in_progress,review}`, `--color-ink-{primary,secondary,tertiary,muted}`, `--color-link`, `--color-app`, `--color-check`, `--radius-{10,14,18,20,24}`, `--font-ui`, `--font-serif`, and utility classes `.glass-panel`, `.glass-card`, `.glass-nav`, `.glass-dialog`, `.glass-raised`
  - `@dlh/ui/theme.css` package export

- [ ] **Step 1: Write the failing test**

```ts
// packages/ui/test/tokens.test.ts
import { readFileSync } from 'node:fs';
import { typeColors, statusColors } from '../src/tokens';
const css = readFileSync(new URL('../src/theme.css', import.meta.url), 'utf8');

test('type colours match the spec', () => {
  expect(typeColors).toEqual({ task: '#9FD9A8', note: '#F5CF7E', project: '#9EC2FF', event: '#F5A8A0', ai: '#CDB6FF' });
  expect(statusColors).toEqual({ in_progress: '#F5CF7E', review: '#9EC2FF' });
});
test('theme.css declares every type colour with the same value', () => {
  for (const [k, v] of Object.entries(typeColors)) expect(css).toContain(`--color-type-${k}: ${v}`);
});
test('every glass recipe emits both backdrop-filter properties', () => {
  for (const cls of ['glass-panel', 'glass-card', 'glass-nav', 'glass-dialog']) {
    const block = css.split(`.${cls}`)[1].split('}')[0];
    expect(block).toMatch(/-webkit-backdrop-filter:/);
    expect(block).toMatch(/[^-]backdrop-filter:/);
  }
});
test('radii are 10, 14, 18, 20, 24', () => {
  for (const r of [10, 14, 18, 20, 24]) expect(css).toContain(`--radius-${r}: ${r}px`);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @dlh/ui exec vitest run test/tokens.test.ts` → Expected: FAIL, cannot find `../src/tokens`.

- [ ] **Step 3: Implement `tokens.ts` and `theme.css`**

`theme.css` starts with `@import "tailwindcss";`, `@plugin "tailwindcss-react-aria-components";`, the `@fontsource` imports, then `@theme { … }` with the Global Constraints values. Glass recipes (values from the Dusk frames):

| Class | Fill | Blur | Border | Radius | Shadow |
|---|---|---|---|---|---|
| `.glass-panel` | `rgba(24,20,32,0.62)` | 20px | `rgba(255,255,255,0.12)` | 20 | — |
| `.glass-card` | `rgba(30,26,40,0.42)` | 18px | `rgba(255,255,255,0.14)` | 18 | — |
| `.glass-nav` | `rgba(22,18,30,0.72)` | 20px | `rgba(255,255,255,0.14)` | 20 | `0 16px 40px rgba(10,8,16,0.4)` |
| `.glass-dialog` | `rgba(30,26,40,0.78)` | 24px | `rgba(255,255,255,0.16)` | 24 (the frame uses 22; rounded to the nearest spec token) | `0 30px 80px rgba(10,8,16,0.5)` |
| `.glass-raised` (board card, no blur) | `rgba(46,40,60,0.88)` | — | `rgba(255,255,255,0.08)` | 14 | — |

Each blurred recipe writes `backdrop-filter: blur(Npx); -webkit-backdrop-filter: blur(Npx);`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @dlh/ui exec vitest run` → Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add packages/ui && git commit -m "feat(ui): Dusk tokens and glass recipes"
```

---

### Task 3: Gallery and screenshot harness

**Files:**
- Create: `packages/ui/src/gallery/Gallery.tsx`, `packages/ui/src/gallery/main.tsx`, `packages/ui/src/gallery/index.html`, `packages/ui/vite.config.ts`, `packages/ui/playwright.config.ts`, `packages/ui/e2e/screenshots.spec.ts`, `packages/ui/test/setup.ts`

**Interfaces:**
- Produces:
  - `type Story = { id: string; title: string; render: () => ReactNode }`
  - `registerStories(group: string, stories: Story[]): void` — each component file's `*.stories.tsx` calls it
  - `<Gallery filter?: string />` renders every registered story in a `[data-story="<id>"]` wrapper over a dusk `Scene` (exported as `@dlh/ui/gallery`)
  - Playwright projects `webkit` and `chromium`; `e2e/screenshots.spec.ts` iterates `[data-story]` elements and calls `expect(el).toHaveScreenshot(\`${id}.png\`)`
  - package scripts: `test` (vitest), `test:screens` (playwright), `gallery` (vite dev)

- [ ] **Step 1: Write the failing test**

`e2e/screenshots.spec.ts`: open `/`, collect all `[data-story]` ids, assert the list is non-empty, screenshot each. Add one placeholder story `tokens/swatches` rendering the five type colours as `TypeTile`-less squares.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @dlh/ui exec playwright test` → Expected: FAIL (no web server / no stories).

- [ ] **Step 3: Implement gallery, Vite config (`root: src/gallery`) and Playwright config (`webServer: pnpm gallery --port 6006`, `projects: [{name:'webkit', use: devices['Desktop Safari']}, {name:'chromium', use: devices['Desktop Chrome']}]`, `expect.toHaveScreenshot.maxDiffPixelRatio: 0.01`).** Vitest uses jsdom with `test/setup.ts` importing `@testing-library/jest-dom/vitest`.

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @dlh/ui exec playwright test --update-snapshots` then `pnpm --filter @dlh/ui exec playwright test` → Expected: passes in both projects.

- [ ] **Step 5: Commit**

```bash
git add packages/ui && git commit -m "test(ui): gallery and WebKit/Chromium screenshot harness"
```

From here on, every component task ends by adding a `*.stories.tsx` covering each variant and state, then running `test:screens --update-snapshots` once and committing the baselines.

---

### Task 4: Scene and GlassPanel

**Files:**
- Create: `packages/ui/src/scene/sceneVariant.ts`, `packages/ui/src/scene/mountains.ts`, `packages/ui/src/scene/Scene.tsx`, `packages/ui/src/glass/GlassPanel.tsx`, stories
- Test: `packages/ui/test/scene.test.tsx`

**Interfaces:**
- Produces:
  - `type SceneVariant = 'morning' | 'dusk' | 'night'`
  - `sceneVariantFor(date: Date): SceneVariant`
  - `sceneTransitionMs(reducedMotion: boolean): number` → `60000` or `0`
  - `useSceneVariant(override?: SceneVariant | null, now?: () => Date): SceneVariant` — re-evaluates every 60 s
  - `<Scene variant?: SceneVariant />` — fixed full-window background; omitted variant uses `useSceneVariant()`; renders `data-variant` on its root; cross-fades between old and new layer sets over `sceneTransitionMs`
  - `<GlassPanel level: 'panel' | 'card' | 'nav' | 'dialog' | 'raised' as?: ElementType className? children />`
  - `scenes: Record<SceneVariant, { sky: string; sun: string; far: string; mid: string; near: string }>` in `mountains.ts`

- [ ] **Step 1: Write the failing tests**

```ts
const at = (h: number, m = 0) => new Date(2026, 9, 30, h, m);
test.each([
  [at(4, 59), 'night'], [at(5), 'morning'], [at(11, 59), 'morning'], [at(12), 'morning'],
  [at(16, 59), 'morning'], [at(17), 'dusk'], [at(20, 59), 'dusk'], [at(21), 'night'], [at(0), 'night'],
])('%s → %s', (d, v) => expect(sceneVariantFor(d)).toBe(v));

test('reduced motion makes the change instant', () => {
  expect(sceneTransitionMs(false)).toBe(60000);
  expect(sceneTransitionMs(true)).toBe(0);
});

test('switches variant when the clock crosses 17:00 without remount', () => {
  vi.useFakeTimers(); vi.setSystemTime(at(16, 59, ));
  render(<Scene />);
  expect(screen.getByTestId('scene')).toHaveAttribute('data-variant', 'morning');
  act(() => { vi.setSystemTime(at(17, 0)); vi.advanceTimersByTime(60_000); });
  expect(screen.getByTestId('scene')).toHaveAttribute('data-variant', 'dusk');
});

test('override wins over the clock', () => {
  vi.setSystemTime(at(9)); render(<Scene variant="night" />);
  expect(screen.getByTestId('scene')).toHaveAttribute('data-variant', 'night');
});

test('GlassPanel applies the recipe class', () => {
  render(<GlassPanel level="nav">x</GlassPanel>);
  expect(screen.getByText('x')).toHaveClass('glass-nav');
});
```

- [ ] **Step 2: Run to verify they fail** — `pnpm --filter @dlh/ui exec vitest run test/scene.test.tsx` → FAIL, module not found.

- [ ] **Step 3: Implement.** `mountains.ts` copies the Dusk Home frame exactly: viewBox `0 0 1440 900`, `preserveAspectRatio="xMidYMax slice"`, sun `cx=980 cy=470 r=70 opacity=0.85`, and the far / mid / near paths:

```
far:  M0 520 L160 440 L290 490 L430 400 L560 470 L700 380 L860 460 L1000 410 L1150 470 L1300 420 L1440 470 L1440 900 L0 900 Z
mid:  M0 600 L120 540 L240 580 L380 510 L520 590 L660 540 L820 610 L960 550 L1120 600 L1260 540 L1440 590 L1440 900 L0 900 Z
near: M0 700 L60 660 L80 680 L100 640 L130 690 L200 650 L260 700 L340 670 L420 720 L560 690 L700 730 L840 690 L980 720 L1080 680 L1120 650 L1140 690 L1200 660 L1260 700 L1320 650 L1360 690 L1440 670 L1440 900 L0 900 Z
```

Palettes:

| Variant | sky | sun | far | mid | near |
|---|---|---|---|---|---|
| dusk | `linear-gradient(180deg, #2E2A45 0%, #6E4E6B 38%, #C98478 62%, #E7AE88 78%)` | `#FFD3A6` | `#7A5A6E` | `#4A3A52` | `#221C2C` |
| night | `linear-gradient(180deg, #0E1222 0%, #1B2140 50%, #34355A 78%)` | `#E8E6F4` | `#2C2F4C` | `#1E2038` | `#0F1020` |
| morning | `linear-gradient(180deg, #4F6E9A 0%, #8BA6C4 45%, #E8C9A6 78%)` | `#FFF1D6` | `#6F86A0` | `#4C5F78` | `#28323F` |

`Scene` reads `prefers-reduced-motion` via `matchMedia` for `sceneTransitionMs`.

- [ ] **Step 4: Run to verify they pass** — same command → all pass.
- [ ] **Step 5: Stories (`scene/morning|dusk|night`, `glass/{panel,card,nav,dialog,raised}`), update baselines, commit**

```bash
git add packages/ui && git commit -m "feat(ui): time-of-day Scene and GlassPanel"
```

---

### Task 5: Primitives A — Button, Checkbox, TextField, SearchField, Switch

**Files:**
- Create: `packages/ui/src/primitives/{Button,Checkbox,TextField,SearchField,Switch}.tsx`, stories
- Test: `packages/ui/test/primitives-a.test.tsx`

**Interfaces:**
- Produces (each wraps the same-named React Aria component and forwards its props):
  - `<Button variant?: 'solid' | 'glass' | 'ghost' | 'dashed' | 'icon' aria-label? />` (default `glass`; `icon` requires `aria-label` at the type level)
  - `<Checkbox />` — 22×22, radius 6, unchecked border `#D9CFD6`, checked fill `#A9B8FF` with `✓` in `#1A1724`
  - `<TextField label description? errorMessage? />`, `<SearchField label placeholder? shortcut?: string />` (shows `<Kbd>` when `shortcut` set — Kbd lands in Task 8; until then render text)
  - `<Switch />`

- [ ] **Step 1: Write the failing tests**

```ts
test('Checkbox toggles with Space and with click', async () => {
  const onChange = vi.fn(); render(<Checkbox onChange={onChange}>Buy milk</Checkbox>);
  const box = screen.getByRole('checkbox', { name: 'Buy milk' });
  await userEvent.click(box); expect(onChange).toHaveBeenLastCalledWith(true);
  box.focus(); await userEvent.keyboard(' '); expect(onChange).toHaveBeenLastCalledWith(false);
});
test('Button variants set data-variant and fire onPress from Enter', async () => {
  const onPress = vi.fn(); render(<Button variant="dashed" onPress={onPress}>+ Add card</Button>);
  const b = screen.getByRole('button', { name: '+ Add card' });
  expect(b).toHaveAttribute('data-variant', 'dashed');
  b.focus(); await userEvent.keyboard('{Enter}'); expect(onPress).toHaveBeenCalledOnce();
});
test('TextField links label and error', () => {
  render(<TextField label="Title" isInvalid errorMessage="Required" />);
  expect(screen.getByRole('textbox', { name: 'Title' })).toHaveAccessibleDescription('Required');
});
test('SearchField clears with Escape', async () => {
  render(<SearchField label="Search" defaultValue="vendor" />);
  const input = screen.getByRole('searchbox'); input.focus(); await userEvent.keyboard('{Escape}');
  expect(input).toHaveValue('');
});
test('Switch exposes role switch', () => { render(<Switch>Use 24h</Switch>); expect(screen.getByRole('switch', { name: 'Use 24h' })).toBeInTheDocument(); });
```

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** Style with Tailwind using React Aria state variants (`data-[pressed]:`, `data-[focus-visible]:outline-2 outline-[--color-link]`, `data-[selected]:`). Every interactive control is at least 44 px tall except `Checkbox` (hit area padded to 44).
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Stories (each variant × default/hover/pressed/focus/disabled), baselines, commit** — `feat(ui): button, checkbox, text, search, switch`.

---

### Task 6: Primitives B — Tabs, Menu, Popover, Dialog, Tooltip, Toast

**Files:**
- Create: `packages/ui/src/primitives/{Tabs,Menu,Popover,Dialog,Tooltip,Toast}.tsx`, stories
- Test: `packages/ui/test/primitives-b.test.tsx`

**Interfaces:**
- Produces:
  - `<Tabs>` / `<TabList>` / `<Tab>` / `<TabPanel>` — segmented look from the Project board frame (track `rgba(30,26,40,0.55)`, selected `rgba(255,255,255,0.18)`)
  - `<MenuTrigger>` / `<Menu>` / `<MenuItem>` / `<MenuSection>`
  - `<Popover>` (uses `.glass-dialog`)
  - `<Modal>` + `<Dialog title?>` (uses `.glass-dialog`, backdrop `rgba(18,15,26,0.45)` + `blur(14px)`)
  - `<TooltipTrigger>` / `<Tooltip>`
  - `ToastRegion` and `toast(message: string, opts?: { tone?: 'info' | 'success' | 'error' }): void` (React Aria `UNSTABLE_ToastQueue`; wrap so modules never import the unstable name)

- [ ] **Step 1: Write the failing tests**

```ts
test('Tabs move with arrow keys', async () => { /* render 3 tabs, focus first, ArrowRight → second has aria-selected=true */ });
test('Dialog closes on Escape and returns focus to the trigger', async () => { /* open via button, Escape, expect trigger toHaveFocus */ });
test('Menu item fires onAction from keyboard', async () => { /* open menu, ArrowDown, Enter → onAction called with key */ });
test('toast() renders a status message', async () => { /* render ToastRegion, call toast('Saved'), expect role=status text Saved */ });
```

Write each body with Testing Library + `userEvent` exactly as described in its comment.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run to verify they pass.**
- [ ] **Step 5: Stories (open states rendered via `defaultOpen`), baselines, commit** — `feat(ui): tabs, menu, popover, dialog, tooltip, toast`.

---

### Task 7: Primitives C — ComboBox, DatePicker, TimeField

**Files:**
- Create: `packages/ui/src/primitives/{ComboBox,DatePicker,TimeField}.tsx`, stories
- Test: `packages/ui/test/primitives-c.test.tsx`

**Interfaces:**
- Produces:
  - `<ComboBox<T> label items: Iterable<T> children: (item: T) => ReactNode onSelectionChange? />` + `<ComboBoxItem />`
  - `<DatePicker label value? onChange? />` (value type `CalendarDate` from `@internationalized/date`, re-exported from `@dlh/ui`)
  - `<TimeField label value? onChange? hourCycle?: 12 | 24 />` (value type `Time`, re-exported)

- [ ] **Step 1: Write the failing tests**

```ts
test('ComboBox filters as you type and Enter selects', async () => {
  const onSel = vi.fn();
  render(<ComboBox label="Project" items={[{id:'q4',name:'Q4 planning'},{id:'web',name:'Website relaunch'}]} onSelectionChange={onSel}>{(p)=> <ComboBoxItem id={p.id}>{p.name}</ComboBoxItem>}</ComboBox>);
  await userEvent.type(screen.getByRole('combobox', { name: 'Project' }), 'q4');
  expect(screen.getAllByRole('option')).toHaveLength(1);
  await userEvent.keyboard('{ArrowDown}{Enter}'); expect(onSel).toHaveBeenCalledWith('q4');
});
test('DatePicker accepts typed segments', async () => { /* type 10/30/2026 into segments → onChange called with CalendarDate 2026-10-30 */ });
test('TimeField respects hourCycle 24', () => { /* render hourCycle={24} value 14:30 → no AM/PM segment */ });
```

- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Stories, baselines, commit** — `feat(ui): combobox, date picker, time field`.

---

### Task 8: Dusk pieces — Dock, TypeTile, Chip, ProgressBar, Breadcrumb, Kbd

**Files:**
- Create: `packages/ui/src/platform.ts`, `packages/ui/src/dusk/{Dock,TypeTile,Chip,ProgressBar,Breadcrumb,Kbd}.tsx`, stories
- Test: `packages/ui/test/dusk.test.tsx`

**Interfaces:**
- Produces:
  - `isMac(platform?: string): boolean` (defaults to `navigator.platform`/`userAgentData`), `modKeyLabel(platform?: string): '⌘' | 'Ctrl'`
  - `type DockItem = { id: string; label: string; icon: LucideIcon; href: string }`
  - `<Dock items: DockItem[] currentHref: string trailing?: ReactNode />` — `.glass-nav`, centred bottom 24 px, marks the current item with `aria-current="page"`
  - `<TypeTile type: ItemType size?: 30 | 34 | 36 />` — rounded square in `typeColors[type]`, Lucide icon in `#1A1724` (task `Check`, note `Pilcrow`, project `LayoutGrid`, event `Clock`, ai `Sparkles`)
  - `<Chip kind: 'project' | 'status' | 'type' color? status?: 'in_progress' | 'review' href? children />` — status chips get the coloured dot and label "In progress" / "Review"
  - `<ProgressBar value: number max: number label: string />` — shows "`value` of `max` done"
  - `<Breadcrumb items: { label: string; href?: string }[] />` — last item `aria-current="page"`
  - `<Kbd keys: string[] />` — `['mod','K']` renders `⌘K` on macOS, `Ctrl K` on Windows

- [ ] **Step 1: Write the failing tests**

```ts
test('Kbd shows Ctrl on Windows and ⌘ on macOS', () => {
  expect(modKeyLabel('Win32')).toBe('Ctrl'); expect(modKeyLabel('MacIntel')).toBe('⌘');
  render(<Kbd keys={['mod','K']} platform="Win32" />); expect(screen.getByText(/Ctrl/)).toBeInTheDocument();
});
test('Dock marks the current item', () => { /* items Home,/ Tasks,/tasks; currentHref '/tasks' → Tasks link aria-current=page, Home not */ });
test('status Chip labels its status', () => { render(<Chip kind="status" status="review" />); expect(screen.getByText('Review')).toBeInTheDocument(); });
test('ProgressBar exposes value and text', () => { render(<ProgressBar value={2} max={9} label="Website relaunch" />); const p = screen.getByRole('progressbar'); expect(p).toHaveAttribute('aria-valuenow','2'); expect(screen.getByText('2 of 9 done')).toBeInTheDocument(); });
test('Breadcrumb marks the last item current', () => { /* Home / Projects / Website relaunch → last aria-current=page */ });
test('TypeTile uses the type colour', () => { render(<TypeTile type="note" />); expect(screen.getByTestId('type-tile')).toHaveStyle({ backgroundColor: '#F5CF7E' }); });
```

`Kbd` takes an optional `platform` prop for tests; `SearchField` from Task 5 now renders `<Kbd>`.

- [ ] **Step 2–4:** fail, implement, pass.
- [ ] **Step 5: Stories, baselines, commit** — `feat(ui): dock, type tile, chip, progress, breadcrumb, kbd`.

---

### Task 9: Patterns — ItemRow, SectionCard, Board, EmptyState, CommandBar shell

**Files:**
- Create: `packages/ui/src/patterns/{ItemRow,SectionCard,Board,EmptyState,CommandBar}.tsx`, stories
- Test: `packages/ui/test/patterns.test.tsx`, add board drag test to `packages/ui/e2e/screenshots.spec.ts` as `board keyboard move`

**Interfaces:**
- Produces:
  - `<ItemRow leading?: ReactNode title: string meta?: ReactNode chips?: ReactNode trailing?: ReactNode href? done?: boolean />` — `done` strikes the title in `#D9CFD6`; min height 52
  - `<SectionCard title: string action?: { label: string; href: string } children />` — `.glass-panel`, heading level 2
  - `type BoardColumnDef = { id: string; title: string; dot: string }`
  - `<Board<T extends { id: string }> columns: BoardColumnDef[] items: T[] columnOf: (item: T) => string renderCard: (item: T) => ReactNode onMove: (itemId: string, toColumn: string, index: number) => void onAdd?: (columnId: string) => void />` — React Aria `GridList` per column with `useDragAndDrop`, cards in `.glass-raised`, "+ Add card" dashed button
  - `<EmptyState icon: LucideIcon title: string body?: string action?: ReactNode />`
  - `type CommandGroup = { id: 'create' | 'actions' | 'ai' | 'jump'; label: string; items: CommandItem[] }`, `type CommandItem = { id: string; label: string; icon?: ReactNode; hint?: string; onAction: () => void }`
  - `<CommandBar isOpen onOpenChange query onQueryChange groups: CommandGroup[] placeholder? footer? />` — `Modal` + `.glass-dialog`, width `min(680px, 100% - 32px)`, top offset 110 px, groups always rendered in the order create → actions → ai → jump, empty groups hidden, ↑↓ moves across groups, Enter runs the highlighted item and closes

- [ ] **Step 1: Write the failing tests**

```ts
test('CommandBar keeps group order and Enter runs the highlighted item', async () => {
  const run = vi.fn();
  render(<CommandBar isOpen onOpenChange={()=>{}} query="" onQueryChange={()=>{}} groups={[
    { id:'jump', label:'Jump to', items:[{ id:'j1', label:'Q4 planning', onAction: ()=>{} }] },
    { id:'create', label:'Create', items:[{ id:'c1', label:'New note', onAction: run }] },
  ]} />);
  const create = screen.getByText('Create'), jump = screen.getByText('Jump to');
  expect(create.compareDocumentPosition(jump) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  await userEvent.keyboard('{Enter}'); expect(run).toHaveBeenCalledOnce();
});
test('ItemRow done state strikes the title', () => { render(<ItemRow title="Draft budget" done />); expect(screen.getByText('Draft budget')).toHaveStyle({ textDecorationLine: 'line-through' }); });
test('SectionCard renders its action link', () => { /* title "Today's focus", action All tasks → link with href */ });
test('EmptyState shows title and action', () => { /* … */ });
```

`e2e` `board keyboard move`: in the `patterns/board` story, focus the first card in "To do", press Enter to start drag, Tab/arrow to "In progress", Enter to drop → the card's text appears inside the In progress column. (Keyboard DnD is unreliable in jsdom, so it lives in Playwright.)

- [ ] **Step 2–4:** fail, implement, pass (`vitest run` and `playwright test -g "board keyboard move"`).
- [ ] **Step 5: Stories (board with the four Website relaunch columns from the Project board frame, command bar empty + populated), baselines, commit** — `feat(ui): item row, section card, board, empty state, command bar`.

---

### Task 10: Layout-only rule for modules

**Files:**
- Create: `scripts/check-module-classes.ts`
- Test: `scripts/check-module-classes.test.ts`

**Interfaces:**
- Produces: `findViolations(source: string, file: string): { file: string; line: number; className: string }[]`; CLI scans `modules/**/*.tsx`, prints violations, exits 1 if any.

Disallowed class prefixes in modules (anything that sets colour, glass, type or shape): `bg-`, `text-` (except `text-left|center|right`), `border-` (except `border-0`), `ring-`, `shadow-`, `backdrop-`, `font-`, `rounded-`, `opacity-`, `from-`, `to-`, `via-`, `fill-`, `stroke-`, and any arbitrary value `[...]` containing `#` or `rgb`.

- [ ] **Step 1: Write the failing test**

```ts
test('layout classes pass', () => expect(findViolations('<div className="flex gap-4 grid-cols-2 p-6" />','a.tsx')).toEqual([]));
test('colour, type and glass classes fail', () => {
  const v = findViolations('<div className="flex bg-white text-lg font-bold backdrop-blur" />','a.tsx');
  expect(v.map(x=>x.className)).toEqual(['bg-white','text-lg','font-bold','backdrop-blur']);
});
test('text alignment is allowed', () => expect(findViolations('<p className="text-center" />','a.tsx')).toEqual([]));
test('arbitrary colour values fail', () => expect(findViolations('<div className="p-[12px] [color:#fff]" />','a.tsx').map(x=>x.className)).toEqual(['[color:#fff]']));
```

- [ ] **Step 2–4:** fail, implement (regex over `className="…"` and `className={'…'}` literals; line numbers from match offsets), pass with `pnpm exec vitest run scripts`.
- [ ] **Step 5: Commit** — `chore: enforce layout-only Tailwind in modules`.

---

### Task 11: Module contract and registry

**Files:**
- Create: `packages/core/package.json`, `packages/core/src/{index,module,registry}.ts`
- Test: `packages/core/test/registry.test.ts`

**Interfaces:**
- Produces (in `@dlh/core`):

```ts
export interface PaletteAction {
  id: string;                                   // 'notes.new'
  label: string | ((ctx: CommandContext) => string);
  icon?: string;                                // Lucide icon name
  group: 'create' | 'actions' | 'ai';
  keywords?: string[];
  shortcut?: string;                            // 'n n'
  when?: (ctx: CommandContext) => boolean;
  run: (ctx: CommandContext) => void | Promise<void>;
}
export interface CommandContext { pathname: string; itemId?: string; selectedText?: string; navigate: (to: string) => void }
export interface Shortcut { keys: string; run: (ctx: CommandContext) => void }   // 'g t'
export interface ModuleManifest {
  id: string;
  itemType?: { type: string; label: string; glyph: string; color: string; href: (id: string) => string };
  nav?: { label: string; icon: string; path: string; order: number; key?: string }; // key: letter for 'g <key>'
  routes: (parent: AnyRoute) => AnyRoute[];
  paletteActions?: PaletteAction[];
  shortcuts?: Shortcut[];
}
export function defineModule(m: ModuleManifest): ModuleManifest;
export interface ModuleRegistry { modules: ModuleManifest[]; nav: NonNullable<ModuleManifest['nav']>[]; itemTypes: Map<string, NonNullable<ModuleManifest['itemType']>>; actions: PaletteAction[] }
export function collectModules(manifests: ModuleManifest[]): ModuleRegistry;
export class ModuleRegistryError extends Error {}
```

`AnyRoute` is TanStack Router's type; `@tanstack/react-router` is a peer dependency of `@dlh/core`.

- [ ] **Step 1: Write the failing test**

```ts
const m = (id: string, nav?: Partial<ModuleManifest['nav']>) => defineModule({ id, routes: () => [], nav: nav && { label: id, icon: 'Box', path: `/${id}`, order: 0, ...nav } });
test('nav is sorted by order', () => expect(collectModules([m('b',{order:2}), m('a',{order:1})]).nav.map(n=>n.label)).toEqual(['a','b']));
test('duplicate module ids throw', () => expect(()=>collectModules([m('a'), m('a')])).toThrow(ModuleRegistryError));
test('duplicate nav paths throw', () => expect(()=>collectModules([m('a',{path:'/x'}), m('b',{path:'/x'})])).toThrow(/\/x/));
test('duplicate g-keys throw', () => expect(()=>collectModules([m('a',{key:'t'}), m('b',{key:'t'})])).toThrow(/g t/));
test('modules without nav still contribute actions', () => {
  const r = collectModules([defineModule({ id:'x', routes: ()=>[], paletteActions:[{ id:'x.a', label:'Do', group:'actions', run(){} }] })]);
  expect(r.nav).toEqual([]); expect(r.actions.map(a=>a.id)).toEqual(['x.a']);
});
```

- [ ] **Step 2–4:** fail, implement, pass (`pnpm --filter @dlh/core exec vitest run`).
- [ ] **Step 5: Commit** — `feat(core): module manifest contract and registry`.

---

### Task 12: Desktop shell

**Files:**
- Create: `apps/desktop/**` per the file structure, `modules/sample/package.json`, `modules/sample/src/{manifest.tsx,SamplePage.tsx}`
- Test: `apps/desktop/test/{hotkeys.test.ts,sceneOverride.test.ts,Shell.test.tsx}`, `apps/desktop/e2e/shell.spec.ts`

**Interfaces:**
- Consumes: `collectModules`, `ModuleManifest` (Task 11); `Scene`, `useSceneVariant`, `Dock`, `CommandBar`, `GlassPanel`, `Kbd`, `Gallery`, `SectionCard`, `EmptyState` (Tasks 3–9).
- Produces:
  - `apps/desktop/src/modules.ts`: `export const registry = collectModules(Object.values(import.meta.glob('../../../modules/*/src/manifest.tsx', { eager: true, import: 'default' })))`
  - `createHotkeys(opts: { platform: string; onCommandBar: () => void; onGo: (key: string) => void }): (e: KeyboardEvent) => void` in `shell/hotkeys.ts` — mod+K always opens; `g` then a letter within 1000 ms calls `onGo`; ignored when `e.target` is an input, textarea, select or contenteditable (except mod+K)
  - `readSceneOverride(raw: string | null): SceneVariant | null` and `SCENE_OVERRIDE_KEY = 'dlh.sceneOverride'` in `shell/sceneOverride.ts` — returns null for anything but the three variant names
  - Routes: `/` (Home), `/settings`, `/dev/ui` (renders `<Gallery />`), plus each module's `routes(root)`
  - `modules/sample` manifest: id `sample`, nav `{ label: 'Sample', icon: 'FlaskConical', path: '/sample', order: 99, key: 's' }`, one page using `SectionCard` + `EmptyState`, one palette action `sample.hello` (toast "Hello from Sample")

- [ ] **Step 1: Write the failing tests**

```ts
// hotkeys.test.ts
const key = (k: string, extra: Partial<KeyboardEventInit> = {}, target: EventTarget = document.body) => { const e = new KeyboardEvent('keydown', { key: k, ...extra }); Object.defineProperty(e,'target',{value:target}); return e; };
test('Ctrl+K opens on Windows, Cmd+K on macOS', () => {
  const win = vi.fn(), mac = vi.fn();
  createHotkeys({ platform:'Win32', onCommandBar: win, onGo(){} })(key('k',{ctrlKey:true}));
  createHotkeys({ platform:'MacIntel', onCommandBar: mac, onGo(){} })(key('k',{metaKey:true}));
  expect(win).toHaveBeenCalledOnce(); expect(mac).toHaveBeenCalledOnce();
});
test('g then t navigates', () => { const go = vi.fn(); const h = createHotkeys({ platform:'MacIntel', onCommandBar(){}, onGo: go }); h(key('g')); h(key('t')); expect(go).toHaveBeenCalledWith('t'); });
test('g t is ignored while typing in an input', () => { const go = vi.fn(); const input = document.createElement('input'); const h = createHotkeys({ platform:'MacIntel', onCommandBar(){}, onGo: go }); h(key('g',{},input)); h(key('t',{},input)); expect(go).not.toHaveBeenCalled(); });
test('mod+K still opens from inside an input', () => { const open = vi.fn(); createHotkeys({ platform:'MacIntel', onCommandBar: open, onGo(){} })(key('k',{metaKey:true}, document.createElement('input'))); expect(open).toHaveBeenCalled(); });

// sceneOverride.test.ts
test.each([['dusk','dusk'],['night','night'],['morning','morning'],[null,null],['noon',null],['{"x":1}',null]])('%s → %s', (raw, out) => expect(readSceneOverride(raw)).toBe(out));

// Shell.test.tsx
test('Dock is built from module manifests and the sample page loads', async () => { /* render app with memory history; expect Dock link "Sample"; click → heading on SamplePage */ });
```

`e2e/shell.spec.ts` (Playwright against `vite` in web mode, Chromium + WebKit): Home shows the greeting panel over the scene; Settings → choose "Night" in the scene override → `[data-testid=scene]` has `data-variant="night"`; reload keeps it; `/dev/ui` lists stories.

- [ ] **Step 2: Run to verify they fail.**
- [ ] **Step 3: Implement.** `Shell` = `<Scene variant={override} />` + routed content + `<Dock items={…registry.nav} trailing={<Button variant="icon" aria-label="Command bar"><Kbd keys={['mod','K']} /></Button>} />` + `<CommandBar>` whose groups are the registry actions filtered by `when` (no search yet). Home: greeting `Good evening` (morning/afternoon/evening by hour), date, and an `EmptyState` saying modules will appear here. Settings: a `Tabs`-style segmented control "Automatic / Morning / Dusk / Night" writing `SCENE_OVERRIDE_KEY` in `localStorage` inside try/catch. Tauri: `create-tauri-app` layout, window 1280×800, min 900×600, title "Digital Life Hub", `decorations: true`, identifier `app.digitallifehub.desktop`.
- [ ] **Step 4: Run to verify they pass** — `pnpm --filter @dlh/desktop exec vitest run && pnpm --filter @dlh/desktop exec playwright test`.
- [ ] **Step 5: Commit** — `feat(desktop): Dusk shell with module-driven nav, settings and /dev/ui`.

---

### Task 13: `pnpm dev`, CI and milestone check

**Files:**
- Create: `scripts/dev.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: `scripts/dev.ts` exporting `type DevStep = { name: string; run: () => Promise<void> }` and `const steps: DevStep[]` (this plan: one step, `turbo run dev --filter=@dlh/desktop`, which runs `tauri dev`); later plans prepend Compose, migrate and seed steps. On first-run without `node_modules`, prints `Run "pnpm install" first.` and exits 1.

- [ ] **Step 1: Implement `scripts/dev.ts`** — runs steps in order, streams output, forwards SIGINT to the child.
- [ ] **Step 2: CI workflow** — matrix `macos-latest`, `windows-latest`: setup mise, `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm --filter @dlh/ui test:screens` (WebKit on macOS, Chromium on both), `pnpm --filter @dlh/desktop tauri build --no-bundle`. Screenshot baselines are per-OS (`{testDir}/__screenshots__/{platform}/{projectName}/`).
- [ ] **Step 3: Verify milestone 1 on macOS** — Run: `pnpm dev`. Expected: a "Digital Life Hub" window opens with the mountain scene for the current time, glass Dock with Home, Sample, ⌘K; `g s` opens Sample; ⌘K opens the command bar with "Hello from Sample"; Settings → Night switches the scene with a 60 s cross-fade.
- [ ] **Step 4: Verify on Windows** — same as Step 3 with Ctrl+K and the `Ctrl K` label. If no Windows machine is at hand, the CI `tauri build` on `windows-latest` plus Chromium screenshots stand in, and the manual check is noted as outstanding.
- [ ] **Step 5: Commit** — `chore: pnpm dev entry point and CI for macOS and Windows`.
