# Digital Life Hub — Design

Oct 29, 2026 · Arek

## Product brief

One place to manage your digital life: a modular dashboard for tasks, notes, projects and bookmarks that later automates actions across other apps.

**Principles**

- **Keyboard-first.** One shortcut opens the command palette; type what you want and it happens.
- **Create and go-to are separate.** Making something new never shares a control with opening something that exists.
- **Calm by default.** The home screen is a place to land, not a wall of data; detail appears as you go deeper.
- **Everything links.** Tasks belong to projects, notes link to notes, and every reference is clickable.
- **Modular.** New capabilities arrive as modules in the same shell, not as separate apps.

**Phases**

1. Task manager with command palette (the starting point)
2. Notes with backlinks and search
3. Project dashboards and Kanban boards
4. Calendar and email integrations
5. AI that understands your tasks, notes and projects
6. Custom widgets and plugins
7. Automated workflows triggered by events

## Visual direction

Dusk Window is the main direction: frosted panels over a landscape scene, warm and personal. Swiss Grid and Sunroom stay on the canvas as alternates.

**Depth rule — the scene recedes as you go deeper**

| Level | Screens | Scene treatment | Panels |
| --- | --- | --- | --- |
| Home | Home | Full scene, no blur | Light frosted glass |
| Browse | Projects, project board, Tasks | Scene shaded darker from the top down | Medium glass, opaque cards |
| Focus | Note, email thread | Scene heavily blurred | Near-solid reading surface |
| Overlay | Command palette | Current screen blurred behind | Strongest glass |

**Object-type colours** — every icon tile, chip and accent for a type uses its colour, everywhere.

| Type | Glyph | Colour |
| --- | --- | --- |
| Task | ✓ | Green |
| Note | ¶ | Yellow |
| Project | ▤ | Blue |
| Event | ◷ | Red |
| Ask AI | ✦ | Violet |

**Scene** — three times of day (dusk, night, morning). The drawn mountains are a placeholder for real wallpapers.

## Navigation and screens

A dock on every screen handles going places; the home tiles and the palette handle creating things.

- **Dock** (bottom, every screen): Home, Tasks, Notes, Projects, Saved, Calendar, Mail, ✦ AI, then ⌘K. The current section is highlighted. Modules switched off in Settings leave the dock.
- **Breadcrumb** on every screen below Home, e.g. Home / Projects / Website relaunch.
- **Command palette** opens on recent items and Go to shortcuts (G T, G N, G P, G S); typing turns into tags and actions.
- **Object tags** on tasks and notes link to their project.

| Screen | Module | Status |
| --- | --- | --- |
| Home | Core | Hi-fi |
| Command palette — recents | Core | Hi-fi |
| Command palette — typing | Core | Hi-fi |
| Projects | Projects | Hi-fi |
| Project board | Projects | Hi-fi |
| Note | Notes | Hi-fi |
| Tasks (Open / Upcoming / Done) | Tasks | Hi-fi |
| Notes index and search | Notes | Wireframe |
| Saved (bookmarks) | Saved | Wireframe |
| Settings (theme, wallpaper) | Core | Wireframe |
| Calendar (week) | Calendar | Wireframe |
| Mail inbox | Mail | Wireframe |
| Mail thread to task | Mail | Wireframe |
| Ask AI side panel | AI | Wireframe |
| Ask AI full conversation | AI | Wireframe |
| Widgets and plugins | Platform | Not started |
| Automation builder | Platform | Not started |

## Key user flows

Every flow ends where the thing belongs, with a link back to where it came from. Calendar, mail and AI flows are wireframes, not settled.

### Return to a project

Four routes, the fastest one click from Home (diagram below).

*[Diagram: routes back to a project · 3 starting points, 4 routes]*

The breadcrumb or the dock takes you back out again from the board.

### Capture from anywhere

1. Press ⌘K, or the + field at the top of any list.
2. Type in plain words, e.g. “Review vendor contracts tomorrow 10am #q4”.
3. The palette turns it into tags (type, date, project) as you type.
4. ↵ creates it in the right place; you stay on the screen you were on.

### Email to task

1. In Mail, open a thread and choose Make task, or accept a deadline the AI spotted in the email.
2. A form opens with title, due date, project and an optional time block filled in.
3. Create: the task keeps a link to the email, and the email moves to Waiting on until the task is done.

### Ask AI about what you're looking at

1. Press ✦ in the dock or choose Ask AI in ⌘K.
2. A side panel opens, scoped to the current screen; context chips show what it can see and can be removed.
3. Answers link the tasks, notes and emails they used.
4. Suggested changes wait for a click; Expand opens the full conversation.

### Plan the week

1. In the full AI conversation, ask for a plan.
2. It proposes a day-by-day plan from due dates and meetings.
3. Add to calendar places time blocks; anything left over sits in Unscheduled tasks to drag in by hand.

## Decision log

Newest first. A changed decision gets a new row; the old one is marked Superseded, never edited.

| Date | Decision | Alternatives considered | Why | Status |
| --- | --- | --- | --- | --- |
| 2026-10-29 | Design docs hold the why; once built, code (tokens, Storybook) holds the what | Markdown specs of every value | Specs that copy code values drift | Settled |
| 2026-10-28 | Four routes back to a project: Jump back in, project tags, Dock → Projects, ⌘K recents | Palette only | Returning to work is the most common trip; it should take one click | Settled |
| 2026-10-28 | Palette opens on recents and Go to before you type | Empty input | ⌘K then ↵ reopens what you were just in | Settled |
| 2026-10-28 | Dock on every screen for navigation | Left sidebar | Keeps Home calm and fits the scenic look; modules add icons | Tentative |
| 2026-10-28 | Home tiles only create; going places lives elsewhere | Tiles that open the module | One control, one job | Settled |
| 2026-10-28 | Projects page: pinned first, then the rest; Active / Someday / Archived | Flat list | Pinned work is what you return to | Settled |
| 2026-10-28 | One colour and glyph per object type | Single accent | Type is recognisable at a glance in every list | Settled |
| 2026-10-28 | The scene recedes with depth: full on Home, shaded on boards, blurred on notes | Same treatment everywhere | Keeps reading screens legible without losing the feel | Settled |
| 2026-10-28 | Dusk Window is the main direction; Swiss Grid and Sunroom kept as alternates | Quiet Utility, Terminal, Soft Modules, Notebook, Evening Den, Warm Swiss | Cozy and personal while still structured | Settled |

## Open questions

- [ ] Dock or a slim frosted left sidebar? Does the dock feel too much like a phone or Mac app on desktop web?
- [ ] Real wallpapers (user-chosen, or changing with time of day) instead of the drawn scene?
- [ ] Do text and panels stay legible in the morning and night scenes?
- [ ] Quick-link icons: favicons fetched from each site, or plain monograms?
- [ ] How much does AI act on its own vs. suggest and wait for a click?
- [ ] Which mail and calendar providers come first?

**Proposed in the wireframes, to confirm**

- [ ] AI never changes anything without a click (suggestions wait for confirm).
- [ ] Making a task from an email moves the email to Waiting on until the task is done.
- [ ] Notes search also returns matching tasks and emails.
- [ ] Time-blocked tasks show on the calendar as dashed blocks, next to events.
- [ ] Settings lets you hide modules from the dock and move the dock to the left.
