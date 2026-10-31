# Digital Life Hub

One personal home for tasks, notes, projects, events and saved things: a single-user desktop app (Tauri + React) backed by a TypeScript API server (Hono + tRPC + Postgres).

## Docs

- [Overview](docs/overview.md): vision, modules, build order and decisions
- [Design](docs/design.md): visual direction, navigation, key flows and decision log
- [Core + Shell spec](docs/specs/core-and-shell.md): the shared platform every module plugs into
- [Items, Links, Search spec](docs/specs/items-links-search.md): the shared data layer (milestone 3)
- [Command Bar capture spec](docs/specs/command-bar-capture.md): natural-language capture (deferred)
- [Implementation plans](docs/superpowers/plans/)

## Getting started

Needs [mise](https://mise.jdx.dev), Docker, and Rust's Tauri prerequisites.

```bash
mise install && pnpm install
pnpm dev
```

`pnpm dev` starts Postgres in Docker, applies migrations, then runs the API and the desktop app. For Google sign-in, copy `apps/api/.env.example` to `apps/api/.env` and fill it in.

| Command | Does |
| --- | --- |
| `pnpm dev` | Starts everything |
| `pnpm dev:down` | Stops Postgres |
| `pnpm db:reset` | Wipes the dev database |
| `pnpm test` | Unit tests |
| `pnpm test:db` | Database tests (needs Postgres) |
| `pnpm typecheck` / `pnpm lint` | Type and lint checks |
