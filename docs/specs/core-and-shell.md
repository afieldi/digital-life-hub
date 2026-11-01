# Core + Shell — Deep-dive Spec

Oct 28, 2026 · Arek

## Scope

Core + shell delivers a signed-in, empty Dusk app on macOS and Windows that any module can plug into. When it is done, adding Tasks means writing the Tasks module and nothing else. Part of the [Digital Life Hub overview](../overview.md).

**In scope**

- Monorepo, build, and unsigned desktop builds for macOS and Windows (code signing comes later)
- API server, database, migrations, single-user sign-in
- Base item model, links, recents, full-text search
- App shell: bottom nav, routing, Dusk theme with time-of-day scenes, glass components
- Basic ⌘K palette: jump to items and run registered actions (no natural-language parsing yet)
- Module registration contract
- AI gateway with OpenRouter and local CLI providers, behind one interface

**Out of scope** (each comes with its module)

- Task, note, project, event and saved screens and fields
- Natural-language capture in the palette
- Google Calendar sync
- Offline editing

## Architecture

The desktop app is a client of one hosted server. All data lives in Postgres behind the API. The only work done on your machine is the UI and running the AI CLIs.

*[Diagram: architecture · desktop app, hosted server, outside services]*

The app never calls OpenRouter or Google directly. The server does, so API keys stay off your devices.

## Stack and repo layout

One pnpm monorepo with TypeScript end to end. Shared Zod schemas mean the app and the API agree on every item's shape at compile time.

Component library: React Aria Components for behaviour (keyboard, focus, combobox, date pickers, drag and drop), styled with Tailwind in `packages/ui`. Chosen over Radix because Radix lacks a combobox, date picker and drag and drop, and React Aria evens out WebKit and Chromium differences.

| Layer | Choice | Why |
| --- | --- | --- |
| Desktop shell | Tauri 2 | Decided in the overview; small, native window controls |
| UI | React + Vite, TanStack Router, TanStack Query | Typed routes; server state cached and refetched on focus |
| Styling | Tailwind CSS v4, design tokens as theme variables | Fast to build module screens; tokens become CSS variables; official React Aria plugin for state styling |
| API | Node + Hono + tRPC | Small, fast server; tRPC gives typed calls with no hand-written client |
| Database | Postgres + Drizzle ORM | Built-in full-text search and trigram matching; typed migrations |
| Validation | Zod | One schema, used by the API, the forms and the AI gateway |
| Tests | Vitest, Playwright for the UI | Same runner on both sides |

```
digital-life-hub/
  apps/
    desktop/        Tauri app: src/ (React), src-tauri/ (Rust: CLI runner, keychain)
    api/            Hono + tRPC server, background jobs
  packages/
    core/           Zod schemas, item types, module contract
    db/             Drizzle schema and migrations
    ui/             Glass components, tokens, scenes
    ai/             Gateway interface and providers
  modules/          One folder per module (tasks/, notes/ ...), added later
```

### Build and run

One command, `pnpm dev`, brings up everything. In development, Docker Compose runs only Postgres; the API and the Tauri app run directly on your machine for fast reloads.

**Tooling**

- pnpm workspaces + Turborepo: links the shared packages into both apps, runs tasks in dependency order, caches results
- Node 22 LTS and Rust, pinned in `mise.toml`
- TypeScript strict mode, Biome for linting and formatting, Vitest for tests
- Drizzle migrations in `packages/db`
- GitHub Actions builds the desktop app on macOS and Windows runners; code signing added later
- Production API ships as a Docker image, which keeps hosting open

**What `pnpm dev` does**

1. `docker compose up -d --wait` starts Postgres and returns once it accepts connections. If Docker Desktop isn't running, it says so clearly.
2. Applies pending migrations.
3. Seeds sample items through the throwaway test module, only when the database is empty. Sample projects, notes and tasks arrive with those modules; Core never hard-codes item types.
4. Starts the API and the Tauri app through Turborepo, with labelled logs in one terminal and hot reload in both.

Ctrl+C stops the API and the app. Postgres keeps running, with its data in a Docker volume, so the next start is faster.

| Command | Does |
| --- | --- |
| `mise install && pnpm install` | First-time setup on a new machine |
| `pnpm dev` | Starts everything |
| `pnpm dev:down` | Stops Postgres |
| `pnpm db:reset` | Wipes the dev database and re-seeds it |
| `pnpm test` | Runs every package's tests |
| `pnpm build` | Builds the API image and the desktop app for your current OS |

## Item model

Every item is one row in `items`. Each module adds a side table keyed by `item_id` for its own fields. Search, links, recents and the palette work on `items` alone, so they never need to know about a module.

**`items`** (owned by Core)

| Column | Type | Notes |
| --- | --- | --- |
| `id` | uuid (v7) | Time-ordered, so new items sort naturally |
| `type` | text | `task`, `note`, `project`, `event`, `saved`; `tag` reserved. Registered by modules, checked against the module registry |
| `title` | text | Required; what the command bar and search show |
| `body_text` | text, nullable | Plain-text version of the content, written by the module for search |
| `created_at` / `updated_at` | timestamptz | `updated_at` set on every write |
| `archived_at` | timestamptz, nullable | Hidden from default views, still searchable |
| `deleted_at` | timestamptz, nullable | Soft delete; purged after 30 days |
| `search` | tsvector, generated | From `title` (weight A) and `body_text` (weight B) |

`items` holds no relationships at all, not even project membership. Every relationship is a row in `links`.

> **Update (milestone 3):** `body_text` is renamed `search_text`, and modules write items only through one server-side helper. See [Items, Links, Search](items-links-search.md).

**Side tables** (owned by each module, sketched here to test the model)

- `tasks`: `item_id`, `status`, `completed_at`, `due_at`, `due_has_time`, `priority`. `status` is one value from a fixed list in code: `todo`, `in_progress`, `review`, `done` (room for one or two more later). A plain task only ever uses `todo` and `done`; the checkbox switches between them, and ticking from any state sets `done`.
- `notes`: `item_id`, `doc` (editor JSON)
- `projects`: `item_id`, `state` (active, someday, archived), `pinned`, `color`, `board_columns`. `board_columns` is the ordered subset of task statuses this project's board shows; `todo` and `done` are always included. A task whose status the board doesn't show sits in the nearest earlier column, with its status chip.
- Reserved, unused in the first version: type `tag` with link kind `tagged`, and a `capture_corrections` table for the [natural-language capture](command-bar-capture.md) follow-up.

A module owns its side table's migrations in `modules/<name>/db`. Core never reads those tables.

## Links, recents and search

One `links` table holds every relationship between items, project membership included. A new kind of relationship is a new `kind` value, never a migration.

**`links`**: `id`, `from_id`, `to_id`, `kind`, `context` (a short text snippet), `created_at`. Unique on (`from_id`, `to_id`, `kind`).

| Kind | Example | Written by |
| --- | --- | --- |
| `contains` | Project → note, project → task, note → task | Any module, or you by dragging or "Also add to…" |
| `mentions` | A note's `[[Website relaunch]]` | Notes, whenever a note is saved (its links are replaced in full) |
| `relates` | A saved link attached to a project | You, from any item |
| `tagged` (reserved) | Tag → item | Not built in the first version |

**Rules for `contains`**

- An item can have several containers: one note can sit in two projects.
- No loops. The server refuses a link that would make an item contain itself, directly or through others.
- Removing a container never deletes what it holds. An item with no container is fine.
- Membership is worked out at read time with one recursive query, never stored. A task in a note in a project counts as in the project. Remove the note from the project and the task leaves too, unless it has its own link.
- An item reachable by two paths is listed and counted once. Project views label tasks found through a note "from \<note title>".

Backlinks are a query: `links where to_id = X`, with `context` as the snippet shown in the Note screen.

**Recents**: an `item_views` table (`item_id`, `viewed_at`). The shell writes a row when an item's screen opens, at most one row per item per 5 minutes. Home's Jump back in and the empty palette read the latest 10 distinct items.

**Search**: one tRPC call, `search(query, types?)`.

- Full-text match on `items.search`, ranked with `ts_rank`
- Trigram match on `title` (`pg_trgm`) so typos and partial words still find items, as palettes need
- Archived items rank lower; deleted items never appear
- Target: under 50 ms server time for 10,000 items

## API and auth

The app talks to the server only through typed tRPC calls over HTTPS. You sign in with Google, limited to your one account, asking only for your email. Calendar access is requested later, when Calendar sync is built.

**Calls**

- Core routers: `items` (get, list, create, update, archive, delete), `links`, `search`, `recents`, `ai`. Each module adds its own router under its name (`tasks.complete`, `notes.save`).
- Every write takes the `updated_at` it was based on. If the row changed since then, the server returns a conflict and the app refetches. With one user this is rare: two devices editing the same item.
- A server-sent events stream, `/changes`, pushes the ids of changed items. The app invalidates those queries, so a task ticked on your Windows PC updates on the Mac within a second or two.

**Sign-in**

1. The app opens Google sign-in in your system browser. Google redirects back to a one-time `localhost` port the app listens on (the standard desktop pattern; it works in development and in unsigned builds, unlike a custom `dlh://` link).
2. The server checks the Google account against one allowed email (set in server config) and issues a session token. Scopes: `openid email` only.
3. Tauri stores the token in the OS keychain (macOS Keychain, Windows Credential Manager). Sessions last 90 days and renew with use.
4. A Devices list in settings shows each session and can revoke it.

No passwords are stored anywhere. If Google sign-in is down, you cannot sign in until it returns; an emergency one-time code printed by the server CLI covers that case.

> **Update (milestone 2):** the emergency one-time code was dropped; Google is the only sign-in. See the [server and sign-in plan](../superpowers/plans/2026-10-30-server-and-sign-in.md).

## App shell

The shell owns the window, the scene behind everything, the bottom nav and ⌘K. Modules fill the space in between by registering a manifest.

**Module contract** (in `packages/core`)

```ts
export interface ModuleManifest {
  id: string;                     // 'tasks'
  itemType?: {
    type: string;                 // 'task'
    label: string;                // 'Task'
    glyph: string;                // icon name
    color: string;                // token, e.g. 'var(--type-task)'
    href: (id: string) => string; // where an item of this type opens
  };
  nav?: { label: string; icon: string; path: string; order: number };
  routes: RouteDefinition[];      // TanStack Router subtree
  paletteActions?: PaletteAction[]; // 'Add task', 'New note'
  shortcuts?: Shortcut[];         // 'g t' -> Tasks
  homeWidgets?: HomeWidget[];     // panels Home can place later
}
```

The shell reads manifests at build time from `modules/*`. A module with no `nav` still gets palette actions and search results.

**Theme and scenes**

- Tokens as CSS variables in `packages/ui`: colours, the five item-type colours, radii (14, 18, 20, 24 px), glass levels (panel, card, nav), type scale. Plus Jakarta Sans for UI, Newsreader for note bodies.
- `<GlassPanel level>` wraps every surface: translucent fill, `backdrop-filter: blur(18–24px)`, a 1 px white border at 12–16% opacity.
- `<Scene>` paints the background. A scene is a set of layers (sky gradient, sun or moon, far, mid and near shapes) with three variants: morning, dusk and night. The variant follows your local clock (morning 05:00–11:59, dusk 17:00–20:59, night 21:00–04:59; midday reuses morning for now) and cross-fades over 60 seconds.
- More scenes later (other landscapes) only need new layer sets. The mountain scene from the designs ships first.

**Nav and routing**

- Floating bottom nav built from module `nav` entries, plus a fixed ⌘K button at the end.
- Routes: `/` (Home, a placeholder until the Home module), `/settings`, and each module's subtree.
- Global keys: ⌘K (Ctrl+K on Windows) opens the palette; Esc closes it; `g` then a letter jumps to a module.

**Palette in Core**: an empty state with Recents and Go to; typing shows search results as Jump to plus matching registered actions. Natural-language parsing comes in a follow-up; see the [capture design doc](command-bar-capture.md).

## Component library

`packages/ui` is built in this first pass, before any module, so every module screen is assembled from the same parts. React Aria Components supply behaviour (keyboard, focus, screen readers, combobox, date pickers, drag and drop); Tailwind v4 supplies the Dusk look.

**Design source.** The Dusk frames on the Directions canvas (a private design canvas, not in this repo) are the reference. Token values (colours, glass fills, blurs, borders, radii, type sizes) are taken from those frames, and the mountain scene's layer paths and the dusk, night and morning palettes come straight from the Home frame's SVG. The greyscale WF frames show layout only.

**1. Tokens** (Tailwind theme variables)

- Colours: text levels; item-type colours (task green, note yellow, project blue, event coral, AI violet); status colours (in progress yellow, review blue)
- Glass levels: panel, card, nav, each a fill + blur + border recipe
- Radii 10, 14, 18, 20, 24 px; spacing; shadows; motion durations
- Type: Plus Jakarta Sans (UI), Newsreader (note bodies)

**2. Primitives** (React Aria, Dusk-styled)

- Button (solid, glass, ghost, dashed add, icon-only), Checkbox, TextField, SearchField, Switch
- Tabs (segmented), Menu, Popover, Dialog, Tooltip, Toast
- ComboBox, DatePicker, TimeField

**3. Dusk pieces**

- `Scene`, `GlassPanel`, `Dock` (bottom nav)
- `TypeTile`, `Chip` (project, status, type), `ProgressBar`, `Breadcrumb`, `Kbd`

**4. Patterns** (shared by several modules)

- `ItemRow` (task rows, Jump back in rows), `SectionCard` (titled panel with a link), `BoardColumn` + `BoardCard` with drag and drop, `EmptyState`, `CommandBar` shell

**Rules**

- Modules import UI only from `@dlh/ui`, never React Aria directly.
- In modules, Tailwind is for layout only (flex, grid, gap, spacing). Colour, glass and type come from components and tokens; a lint rule enforces it.
- Icons from Lucide, matching the stroke icons in the designs.
- Every component has behaviour and keyboard tests, plus screenshot tests rendered in WebKit (macOS Tauri) and Chromium (Windows Tauri).
- A hidden `/dev/ui` route shows every component in every state, for checking on a real Mac and PC.

## AI gateway

The server always builds the prompt and checks the answer; only the model call moves. That keeps context-building and safety in one place whichever provider runs.

```ts
export interface AiProvider {
  id: 'openrouter' | 'claude-cli' | 'codex-cli';
  runs: 'server' | 'desktop';
  complete(req: {
    system: string;
    prompt: string;
    schema?: JsonSchema;   // structured output, e.g. a list of tasks
    model?: string;        // OpenRouter model id; ignored by CLIs
  }): Promise<{ text: string; json?: unknown }>;
}
```

**One request, step by step**

1. You ask ("Turn the priorities into tasks"). The app calls `ai.prepare` with the action and the current item.
2. The server gathers context: the item, its links, and search results when the action needs them (you allowed access to everything, on request).
3. If your chosen provider runs on the server (OpenRouter), the server calls it and goes to step 5.
4. If it is a CLI, the server returns the prepared prompt. The Tauri app runs `claude -p` or `codex exec` with JSON output, the prompt on stdin, a 120-second timeout, then posts the raw answer back with `ai.complete`.
5. The server validates the answer against the schema and returns the result. Ask actions only answer, Suggest actions wait for you to pick, and Do actions apply at once with Undo; deletes and changes to other items always show first. See [AI Gateway](ai-gateway.md).

**Rules**

- The Rust side only runs the two allowlisted binaries, found on `PATH` or set in settings, and never passes shell strings.
- Settings pick a default provider and model, and show whether each CLI is installed and signed in.
- Background jobs (with the app closed) always use OpenRouter.
- Each request is logged (provider, model, tokens or duration, action) for your own review; prompts are not stored.

## Milestones

Four milestones, each ending in something you can run. Core is done when all four pass and a throwaway test module plugs in with no changes to Core.

1. **Skeleton.** Monorepo, Tauri app opening a Dusk window with the scene, glass nav and an empty Home.
   - Done when: `pnpm dev` opens the app on macOS and Windows, and the scene changes with the clock (testable with a time override in settings).
2. **Server and sign-in.** API, Postgres, migrations, Google sign-in, keychain token, Devices list.
   - Done when: you sign in, quit and reopen without signing in again, and revoking that session from the Devices list (or a test script) signs the app out.
3. **Items, links, search.** `items`, `links`, `item_views`, the search call, the `/changes` stream, the ⌘K palette with Recents and Jump to.
   - Done when: a test module creates 10,000 items, search returns under 50 ms, and an edit made through a second client (a test script against the local API) shows in the open app within 2 seconds.
   - Deep dive: [Items, Links, Search](items-links-search.md).
   - Status: done (Oct 31, 2026). Search p95 about 29 ms over 10,000 items; the e2e rename check passes in Chromium and WebKit.
4. **AI gateway.** Provider interface, OpenRouter, Claude Code and Codex runners, AI actions (Ask, Suggest, Do with Undo), request interpreter, settings.
   - Done when: "summarise this item" and "give this a better title" (with Undo) work through all three providers, a malformed answer is rejected with a clear message, "delete this" is shown first, and all of it shows in the request log.
   - Deep dive: [AI Gateway](ai-gateway.md).

## Open questions

None of these block this pass: the API, database and app all run locally in development. The rest have a default in this spec that you can overrule.

- [ ] **Hosting.** Options: a managed app host plus managed Postgres (for example Fly.io or Railway with Neon), roughly $10–25 a month; a small VPS running both (cheaper, you patch it); or your own home server (free, but reachable from outside only through a tunnel such as Tailscale).
- [ ] **Google sign-in.** OK as the only sign-in, with the server-printed emergency code as backup? Alternative: a passkey.
- [ ] **Midday scene.** 12:00–16:59 reuses morning. Is a separate daytime variant wanted?
- [ ] **Stack choices.** Hono + tRPC + Drizzle are defaults, not decisions. Any you'd rather swap?
- [ ] **Soft-delete window.** 30 days before purge: right length?
