# Digital Life Hub — Overview

Oct 28, 2026 · Arek

## Vision and principles

The Digital Life Hub is one personal home for tasks, notes, projects, events and saved things. You capture anything from one command bar, and everything links to everything else. It is built for one person (you), on top of separate modules that can each ship by themselves.

- **One place to start.** Home answers "what's left today?" and "where was I?". Capture is always one keystroke away (⌘K).
- **Capture first, organize later.** Typing plain language ("Review vendor contracts tomorrow 10am #q4") turns into a typed item with date and project already filled in.
- **Everything links.** Tasks belong to projects, notes link to notes with `[[wiki links]]`, and backlinks show up on their own. The connections are the product.
- **Modular by design.** Each feature area is a module with its own data and screens. Modules plug into a shared core: one item model, one search, one palette, one shell.
- **AI as a helper, not the centre.** "Ask AI" works on what is in front of you: turn a note into tasks, find what is unresolved, see what else is open in a project.
- **Calm.** Few items on screen, a short daily focus list, and a look that changes with the time of day.

## Design reference

The Directions canvas (a private design canvas, not in this repo) holds three looks. Dusk is the chosen direction; Sunroom and Swiss stay only as reference.

| Direction | Look | What it shows |
| --- | --- | --- |
| I · Dusk | Dark glass panels over a layered mountain sky that changes with time of day (dusk, night, morning); Plus Jakarta Sans, Newsreader serif for note bodies | Home, command palette (empty and typing), Projects, Project board, Note |
| G · Sunroom | Light sage and cream, green accent | Today as a week strip plus Morning / Afternoon / Evening blocks; a chat-style assistant confirms a parsed task |
| C · Swiss Grid | White, strict grid, numbered rows, red accent | Today as a numbered list with Open / Done counts; palette shows parsed fields (type, when, project, priority) |

**Dusk screens and the patterns they set:**

1. **Home.** Greeting with a one-line status ("Three things left"), clock, ⌘K bar, five Create tiles (Task, Note, Project, Event, Ask AI), Today's focus (3 tasks with project chips), and Jump back in (recent items).
2. **Command palette, empty.** Recent items plus Go to shortcuts (G T, G N, G P, G S).
3. **Command palette, typing.** Natural-language input parsed into chips (Task · Thu Oct 29 10:00 · Q4 planning). Results grouped as Create, Ask AI and Jump to.
4. **Projects.** Tabs for Active, Someday and Archived. Pinned cards show the next task and progress ("2 of 9 done"); the rest sit in a compact list.
5. **Project board.** Kanban with To do, In progress, Review and Done. Cards carry a tag, due date and linked-note count. Views: Board, List, Notes.
6. **Note.** Note list, a serif reading body with `[[wiki links]]`, inline tasks pulled from the note, a backlinks panel with snippets, and Ask about this note.

Shared shell: a floating bottom nav (Home, Tasks, Notes, Projects, Saved, ⌘K) and one colour per item type (task green, note yellow, project blue, event coral, AI violet).

## Modules

Eight modules cover what the designs show. Each owns its own screens and item type, and gets a deep-dive spec before it is built.

| Module | Purpose | Key features from the designs | Depends on |
| --- | --- | --- | --- |
| Home | Daily start page | Greeting + status line, Create tiles, Today's focus, Jump back in, time-of-day scene | Tasks, Projects, Notes, recents |
| Command palette | Capture, search and navigate from one input | ⌘K anywhere, natural-language parsing into chips, grouped results (Create / Ask AI / Jump to), Go to shortcuts | Core item model, search |
| Tasks | Things to do | Checkbox done/undo, due date and time, project link, priority, Today view (Swiss and Sunroom show alternatives) | Core |
| Notes | Long-form writing and knowledge | Rich text body, `[[wiki links]]`, backlinks with snippets, inline tasks, note list | Core, Tasks |
| Projects | Group work toward an outcome | Active / Someday / Archived, pinned projects, next-up task, progress count, Board / List / Notes views, kanban columns | Tasks, Notes |
| Events / Calendar | Time-bound items | "Block time on the calendar" (marked Soon), week strip in Sunroom | Core, Google Calendar |
| Saved | Bookmarks and clippings | A nav slot exists in every design; no screen yet | Core |
| AI assistant | Help in context | Ask AI tile, "Turn the priorities into tasks", "What's still unresolved?", "What else is open in Q4 planning?" | All modules' data, OpenRouter or a local CLI |

Events, Saved and AI have no full screen yet, so their deep dives start with design work.

## Shared platform

Modules never reach into each other's storage. They share one core, and that core is what we build first.

*[Diagram: architecture · shell, 8 modules, 5 core services]*

A task inside a note, or a project's linked notes, works through the shared item model and links, not module-to-module calls.

- **Item model.** Every task, note, project, event and saved link is an item with the same base fields: id, type, title, created and updated times, and an optional project. Each module adds its own fields on top.
- **Links.** One relation table for "task in project", "note links to note" and "task came from note". Backlinks are a query on it, not stored twice.
- **Search.** One full-text index over all items. It feeds the palette's Jump to results and Recents.
- **Storage and sync.** One database behind a thin data layer, so a module can be added without schema changes to the others. Server-first: a hosted database the desktop app reaches through an API.
- **AI gateway.** One place that builds context from items and calls the LLM through a provider: OpenRouter over HTTP, or the Claude Code or Codex CLI run in non-interactive mode on your machine. Modules ask it for actions ("turn this note into tasks"); it returns items to create, which you confirm.
- **App shell.** Bottom nav, ⌘K, routing, keyboard shortcuts, and the theme with its time-of-day scene. A module registers its nav slot, palette actions and item colour.

## Approach

We build one module at a time. Each one goes through the same steps, and nothing is built until its spec is agreed.

1. **Deep-dive spec.** A doc for that module: user flows, every screen state (empty, loading, error), fields and data, its links to other modules, and what is out of scope.
2. **Design pass.** Finish or adjust its screens on the Directions canvas, in the Dusk look.
3. **Build.** Implement against the shared core, adding only the core pieces this module needs.
4. **Use it.** Live with it for a few days before starting the next module, and feed what you learn back into this overview.

This doc stays the map. Each deep dive links back here, and the Modules table gets updated when scope changes.

**Deep dives:** [Core + Shell](specs/core-and-shell.md) (draft) · [Command Bar — Natural-language Capture](specs/command-bar-capture.md) (deferred, follow-up after Core)

## Suggested build order

Start with the core and Tasks. Tasks is the smallest useful module, and it tests the item model before Notes and Projects lean on it.

1. **Core + shell.** Item model, storage, links table, bottom nav, theme. Nothing user-facing beyond an empty shell.
2. **Tasks.** Create, complete, due dates, Today view. The first thing you can use every day.
3. **Projects.** Group tasks, progress counts, the board. This proves the links model.
4. **Notes.** Editor, `[[wiki links]]`, backlinks, inline tasks. The biggest module, built on a tested core.
5. **Command palette.** Basic ⌘K jump and create early on; natural-language parsing lands here, once there are three item types to parse into.
6. **Home.** Mostly views of modules 2–4, so it comes after them.
7. **Events, Saved, AI assistant.** Each needs design work first. AI goes last because it is most useful once the other modules hold real data.

The order can bend: Notes could come before Projects if writing matters more to you day to day.

## Decisions

The hub is a single-user desktop app in TypeScript and React, backed by a hosted server, in the Dusk look only.

| Topic | Decision | What it means for the build |
| --- | --- | --- |
| Platform | Desktop app | macOS and Windows. React UI inside a Tauri shell |
| Data | Server-first | Hosted database behind an API; the desktop app is a client of it |
| Users | Just you | One account, no sharing or permissions model |
| Stack | TypeScript + React | TypeScript on both sides: React UI, Node API |
| Look | Dusk only | Glass panels over a background, always. Time of day stays; backgrounds become swappable scenes within that look |
| Calendar | Two-way Google Calendar sync | Events needs Google sign-in and a sync job on the server |
| AI provider | OpenRouter, or a local CLI (Claude Code, Codex) | The AI gateway has swappable providers: OpenRouter (pay per use, any model) or a CLI on your machine, so a Claude or ChatGPT subscription can cover the usage. The Tauri app runs the CLI locally when you ask; background jobs on the server use OpenRouter |
| AI access | Anything, on request | The gateway may search all items to build context |
| Import | None for now | Start fresh; revisit later |

**Still open**

- [ ] Hosting: where the API and database run.
- [ ] Saved: what it holds. Decide in its deep dive.

**Tauri or Electron**

The risk is the glass look, not bundle size. Tauri draws with each OS's own browser engine; Electron ships Chromium everywhere.

|  | Tauri | Electron |
| --- | --- | --- |
| Engine on macOS | WebKit (Safari) | Chromium |
| Engine on Windows | WebView2 (Chromium) | Chromium |
| Engine on Linux | WebKitGTK, weakest for blur effects | Chromium |
| App size | A few MB | Around 100 MB+ |
| Same rendering everywhere | No | Yes |

The glass is CSS `backdrop-filter` blur over a painted background, so what matters is how each engine draws it. Linux is out of scope, so Tauri's weakest engine doesn't apply. Decision: Tauri, with no spike up front. If the glass looks wrong on Windows during the build, Electron is the fallback; the React UI moves over unchanged.
