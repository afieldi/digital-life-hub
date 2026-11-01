import { resolve } from "node:path";
import { freshTestDb } from "@dlh/db/testing";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach } from "vitest";
import {
  type CliProviderId,
  type CliRunner,
  type CliStatus,
  setCliRunnerForTests,
} from "../src/ai/cli";
import { signedInApp } from "./apiHarness";

// jsdom gives @dlh/db no file URL to find its migrations from; tests run from apps/desktop.
const MIGRATIONS = resolve(process.cwd(), "../../packages/db/drizzle");

const closers: Array<() => Promise<void>> = [];
beforeEach(() => localStorage.clear());
afterEach(async () => {
  // Toasts live in a module-level queue that outlives each render.
  for (const b of screen.queryAllByRole("button", { name: "Dismiss" })) {
    fireEvent.click(b);
  }
  await waitFor(() =>
    expect(screen.queryAllByRole("button", { name: "Dismiss" })).toHaveLength(
      0,
    ),
  );
  cleanup();
  setCliRunnerForTests(null);
  localStorage.clear();
  await Promise.all(closers.splice(0).map((close) => close()));
});

const ready: CliStatus = { installed: true, signedIn: true, version: "1" };

/** A CLI runner whose status is read from `statuses` on every check. */
function fakeStatus(
  statuses: Record<CliProviderId, CliStatus> = {
    "claude-cli": ready,
    "codex-cli": ready,
  },
) {
  const calls: Array<{ provider: CliProviderId; path: string | null }> = [];
  const runner: CliRunner = {
    run: async () => ({ stdout: "", exitCode: 0 }),
    status: async (provider, path) => {
      calls.push({ provider, path });
      return statuses[provider];
    },
    cancel: async () => {},
  };
  setCliRunnerForTests(runner);
  return { calls, statuses };
}

type Seeded = Awaited<ReturnType<typeof seeded>>;

async function seeded(opts: { noOpenRouter?: boolean }) {
  const t = await freshTestDb(MIGRATIONS);
  closers.push(t.close);
  const app = await signedInApp("/settings", { db: t.db, ...opts });
  const client = app.api.client(app.token);
  const item = await client.sample.create.mutate({ title: "Hello item" });
  return { ...app, client, item, fake: app.api.ai };
}

/** Starts the app on Settings; `seed` runs before it renders. */
async function setup(
  opts: { noOpenRouter?: boolean; seed?: (s: Seeded) => Promise<void> } = {},
) {
  const s = await seeded(opts);
  await opts.seed?.(s);
  s.renderApp();
  await screen.findByRole("heading", { name: "AI" });
  return s;
}

async function row(name: string) {
  const title = await screen.findByText(name);
  return title.closest("div.relative") as HTMLElement;
}

async function choose(label: string, option: string) {
  await userEvent.click(
    await screen.findByRole("button", {
      name: new RegExp(`Show ${label} options`),
      hidden: true,
    }),
  );
  await userEvent.click(await screen.findByRole("option", { name: option }));
}

test("the default provider is chosen from a select and saved on the server", async () => {
  fakeStatus();
  const { client } = await setup();
  const select = await screen.findByRole("combobox", {
    name: "Default provider",
  });
  expect(select).toHaveValue("OpenRouter");
  await choose("Default provider", "Codex");
  await waitFor(async () =>
    expect((await client.ai.settings.get.query()).defaultProvider).toBe(
      "codex-cli",
    ),
  );
  await waitFor(() => expect(select).toHaveValue("Codex"));
});

test("OpenRouter is Ready when the server has a key", async () => {
  fakeStatus();
  await setup();
  expect(
    within(await row("OpenRouter")).getByText("Ready"),
  ).toBeInTheDocument();
});

test("OpenRouter says Not set up on the server without a key", async () => {
  fakeStatus();
  await setup({ noOpenRouter: true });
  expect(
    within(await row("OpenRouter")).getByText("Not set up on the server"),
  ).toBeInTheDocument();
});

test("CLI rows show Not installed or Signed out, and Check again re-runs the check", async () => {
  const fake = fakeStatus({
    "claude-cli": { installed: false, signedIn: false, version: null },
    "codex-cli": { installed: true, signedIn: false, version: "1" },
  });
  await setup();
  const claude = await row("Claude Code");
  const codex = await row("Codex");
  expect(await within(claude).findByText("Not installed")).toBeInTheDocument();
  expect(await within(codex).findByText("Signed out")).toBeInTheDocument();
  const before = fake.calls.filter((c) => c.provider === "claude-cli").length;

  fake.statuses["claude-cli"] = ready;
  await userEvent.click(
    within(claude).getByRole("button", { name: "Check again" }),
  );
  expect(await within(claude).findByText("Ready")).toBeInTheDocument();
  expect(fake.calls.filter((c) => c.provider === "claude-cli").length).toBe(
    before + 1,
  );
  expect(within(codex).getByText("Signed out")).toBeInTheDocument();
});

test("a program path is kept on this device and used by the next check", async () => {
  const fake = fakeStatus();
  await setup();
  await userEvent.click(await screen.findByText("Advanced"));
  const path = await screen.findByRole("textbox", {
    name: "Claude Code program path",
  });
  await userEvent.type(path, "/opt/bin/claude");
  await userEvent.tab();
  expect(localStorage.getItem("dlh.ai.cliPath.claude-cli")).toBe(
    "/opt/bin/claude",
  );
  await waitFor(() =>
    expect(fake.calls.at(-1)).toEqual({
      provider: "claude-cli",
      path: "/opt/bin/claude",
    }),
  );
  await userEvent.clear(path);
  await userEvent.tab();
  expect(localStorage.getItem("dlh.ai.cliPath.claude-cli")).toBeNull();
});

test("the interpreter select offers Keywords", async () => {
  fakeStatus();
  await setup();
  await userEvent.click(await screen.findByText("Advanced"));
  expect(
    await screen.findByRole("combobox", { name: "Interpreter" }),
  ).toHaveValue("Keywords");
});

test("the OpenRouter model is saved, and emptied it becomes unset", async () => {
  fakeStatus();
  const { client } = await setup();
  const model = await screen.findByRole("textbox", {
    name: "OpenRouter model",
  });
  await userEvent.type(model, "acme/some-model");
  await userEvent.tab();
  await waitFor(async () =>
    expect((await client.ai.settings.get.query()).openrouterModel).toBe(
      "acme/some-model",
    ),
  );
  await userEvent.clear(model);
  await userEvent.tab();
  await waitFor(async () =>
    expect((await client.ai.settings.get.query()).openrouterModel).toBeNull(),
  );
});

test("Recent requests lists each request, and Undo reverts it and goes away", async () => {
  fakeStatus();
  const { client, item } = await setup({
    seed: async ({ client, fake, item }) => {
      fake.queue(JSON.stringify({ answer: "Forty-two.", used: [] }));
      await client.ai.prepare.mutate({
        text: "what is it",
        actionId: "answer",
        kind: "ask",
      });
      fake.queue(JSON.stringify({ title: "Better title" }));
      await client.ai.prepare.mutate({
        text: "rename",
        itemId: item.id,
        actionId: "retitle",
        kind: "do",
      });
    },
  });
  const rename = await row("Rename");
  const answer = await row("Answer");
  expect(within(rename).getByText(/Do/)).toBeInTheDocument();
  expect(within(rename).getByText(/OpenRouter/)).toBeInTheDocument();
  expect(within(rename).getByText(/test-model/)).toBeInTheDocument();
  expect(within(rename).getByText("Applied")).toBeInTheDocument();
  expect(within(answer).getByText("Answered")).toBeInTheDocument();
  expect(within(answer).queryByRole("button", { name: "Undo" })).toBeNull();

  await userEvent.click(within(rename).getByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Undid rename")).toBeInTheDocument();
  await waitFor(() =>
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull(),
  );
  expect((await client.items.get.query(item)).title).toBe("Hello item");
});

test("Load more fetches the next page of requests", async () => {
  fakeStatus();
  await setup({
    seed: async ({ client, fake }) => {
      for (let i = 0; i < 51; i++) {
        fake.queue(JSON.stringify({ answer: "Hi.", used: [] }));
        await client.ai.prepare.mutate({
          text: "q",
          actionId: "answer",
          kind: "ask",
        });
      }
    },
  });
  await screen.findAllByText("Answered");
  expect(screen.getAllByText("Answered")).toHaveLength(50);
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(screen.getAllByText("Answered")).toHaveLength(51));
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

test("with no requests yet, Recent requests says so", async () => {
  fakeStatus();
  await setup();
  expect(await screen.findByText("No requests yet.")).toBeInTheDocument();
});
