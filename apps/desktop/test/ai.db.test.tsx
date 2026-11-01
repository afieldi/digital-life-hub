import { resolve } from "node:path";
import { freshTestDb } from "@dlh/db/testing";
import { isMac } from "@dlh/ui";
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach } from "vitest";
import {
  CliError,
  type CliRunInput,
  type CliRunner,
  setCliRunnerForTests,
} from "../src/ai/cli";
import { signedInApp } from "./apiHarness";

// jsdom gives @dlh/db no file URL to find its migrations from; tests run from apps/desktop.
const MIGRATIONS = resolve(process.cwd(), "../../packages/db/drizzle");

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  // Toasts live in a module-level queue that outlives each render: dismiss
  // them while the region is still mounted, then unmount.
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
  await Promise.all(closers.splice(0).map((close) => close()));
});

async function setup(opts: { onHome?: boolean } = {}) {
  const t = await freshTestDb(MIGRATIONS);
  closers.push(t.close);
  const app = await signedInApp("/", { db: t.db });
  const client = app.api.client(app.token);
  const sample = await client.sample.create.mutate({ title: "Hello item" });
  if (!opts.onHome) app.router.history.push(`/sample/${sample.id}`);
  app.renderApp();
  if (!opts.onHome) {
    await screen.findByRole("heading", { name: "Hello item", level: 1 });
  }
  const title = async () => (await client.items.get.query(sample)).title;
  return { ...app, client, sample, fake: app.api.ai, title };
}

async function ask(text: string) {
  await userEvent.click(
    await screen.findByRole("button", { name: "Command bar" }),
  );
  const input = await screen.findByRole("combobox");
  await userEvent.type(input, text);
  return input;
}

/**
 * Waits until the search for the text as typed found no rows, so ↵ asks AI.
 * "No items match" alone may still be the answer for older text.
 */
const searched = () =>
  waitFor(() =>
    expect(
      screen.getByText("to ask AI").querySelector("kbd"),
    ).toHaveTextContent(/^↵$/),
  );

/** ⌘↵ on macOS, Ctrl+↵ elsewhere. */
const modEnter = () =>
  userEvent.keyboard(
    isMac() ? "{Meta>}{Enter}{/Meta}" : "{Control>}{Enter}{/Control}",
  );

const retitleOptions = JSON.stringify({
  options: [
    { title: "First idea", reason: "Short." },
    { title: "Second idea", reason: "Clear." },
    { title: "Third idea", reason: "Specific." },
  ],
});

/** A CLI runner that answers with `stdout`, recording its requests. */
function fakeCli(stdout: (req: CliRunInput) => string | Promise<string>) {
  const calls: CliRunInput[] = [];
  const runner: CliRunner = {
    run: async (req) => {
      calls.push(req);
      return { stdout: await stdout(req), exitCode: 0 };
    },
    status: async () => ({ installed: true, signedIn: true, version: "1" }),
    cancel: async () => {},
  };
  setCliRunnerForTests(runner);
  return { calls, runner };
}

test("a rename request on an item is understood as Rename, Do; Tab switches to Suggest", async () => {
  await setup();
  await ask("give this a better title");
  expect(await screen.findByText("Rename")).toBeInTheDocument();
  expect(screen.getByRole("radio", { name: "Do" })).toBeChecked();
  expect(
    await screen.findByText("Changes it now, with Undo after · OpenRouter"),
  ).toBeInTheDocument();
  // Search results stay visible under the row while typing.
  expect(screen.getByRole("listbox", { name: "Results" })).toBeInTheDocument();
  await userEvent.keyboard("{Tab}");
  expect(screen.getByRole("radio", { name: "Suggest" })).toBeChecked();
  expect(
    screen.getByText(
      "Shows options, changes nothing until you pick · OpenRouter",
    ),
  ).toBeInTheDocument();
  await userEvent.keyboard("{Tab}");
  expect(screen.getByRole("radio", { name: "Do" })).toBeChecked();
});

test("↵ on Do renames at once with an Undo toast, and Undo restores", async () => {
  const { fake, title } = await setup();
  fake.queue(JSON.stringify({ title: "Better title" }));
  await ask("give this a better title");
  await screen.findByText("Rename");
  // No result rows are listed, so ↵ runs the request.
  await screen.findByText("No items match");
  expect(screen.getByText("to ask AI").querySelector("kbd")).toHaveTextContent(
    /^↵$/,
  );
  await userEvent.keyboard("{Enter}");
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  expect(
    await screen.findByText("Renamed to “Better title”"),
  ).toBeInTheDocument();
  expect(await title()).toBe("Better title");
  await userEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(await screen.findByText("Undid rename")).toBeInTheDocument();
  expect(await title()).toBe("Hello item");
});

test("Suggest shows three options and Use applies the one picked", async () => {
  const { fake, title } = await setup();
  fake.queue(retitleOptions);
  await ask("suggest a few titles");
  expect(await screen.findByRole("radio", { name: "Suggest" })).toBeChecked();
  await searched();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByText("Second idea")).toBeInTheDocument();
  expect(screen.getByText("Clear.")).toBeInTheDocument();
  const uses = screen.getAllByRole("button", { name: /^Use / });
  expect(uses).toHaveLength(3);
  await userEvent.click(uses[1] as HTMLElement);
  expect(
    await screen.findByText("Renamed to “Second idea”"),
  ).toBeInTheDocument();
  expect(await title()).toBe("Second idea");
  expect(screen.queryByRole("combobox")).toBeNull();
});

test("keys 1–3 pick a suggested option", async () => {
  const { fake, title } = await setup();
  fake.queue(retitleOptions);
  await ask("suggest a few titles");
  await screen.findByText("Rename");
  await searched();
  await userEvent.keyboard("{Enter}");
  await screen.findByText("Third idea");
  await userEvent.keyboard("3");
  await waitFor(async () => expect(await title()).toBe("Third idea"));
});

test("None of these discards the options and changes nothing", async () => {
  const { fake, title, client } = await setup();
  fake.queue(retitleOptions);
  await ask("suggest a few titles");
  await screen.findByText("Rename");
  await searched();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: "None of these" }),
  );
  await waitFor(async () => {
    const { entries } = await client.ai.log.list.query({});
    expect(entries[0]?.status).toBe("discarded");
  });
  expect(await title()).toBe("Hello item");
});

test("“delete this” is offered as Suggest only, shown first", async () => {
  await setup();
  await ask("delete this");
  expect(await screen.findByText("Delete")).toBeInTheDocument();
  expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
    "Suggest",
  ]);
  expect(screen.getByRole("radio", { name: "Suggest" })).toBeChecked();
  expect(
    await screen.findByText("Deletes always show you first · OpenRouter"),
  ).toBeInTheDocument();
});

test("Show options after a Do runs the same request as Suggest", async () => {
  const { fake } = await setup();
  fake.queue(JSON.stringify({ title: "Better title" }), retitleOptions);
  await ask("give this a better title");
  await screen.findByText("Rename");
  await searched();
  await userEvent.keyboard("{Enter}");
  await userEvent.click(
    await screen.findByRole("button", { name: "Show options" }),
  );
  expect(await screen.findByRole("combobox")).toHaveValue(
    "give this a better title",
  );
  expect(await screen.findByText("Second idea")).toBeInTheDocument();
  expect(await screen.findByRole("radio", { name: "Suggest" })).toBeChecked();
  expect(fake.calls).toHaveLength(2);
  expect(fake.calls[1]?.prompt).toContain("give this a better title");
});

test("an Ask answer shows the items it used as links, and Copy", async () => {
  const { fake, client } = await setup();
  const other = await client.sample.create.mutate({ title: "Linked note" });
  fake.queue(
    JSON.stringify({ answer: "It greets the world.", used: [other.id] }),
  );
  await ask("summarise this");
  expect(await screen.findByRole("radio", { name: "Ask" })).toBeChecked();
  await searched();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByText("It greets the world.")).toBeInTheDocument();
  const link = await screen.findByRole("link", { name: "Linked note" });
  expect(link).toHaveAttribute("href", `/sample/${other.id}`);
  expect(screen.getByRole("button", { name: "Copy" })).toBeInTheDocument();
});

test("a Claude Code bad_output shows the exact message and Use OpenRouter retries", async () => {
  const { fake, client, title } = await setup();
  await client.ai.settings.set.mutate({ defaultProvider: "claude-cli" });
  const cli = fakeCli(() => "not json at all");
  await ask("suggest a few titles");
  expect(
    await screen.findByText(
      "Shows options, changes nothing until you pick · Claude Code",
    ),
  ).toBeInTheDocument();
  await searched();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByText(
      "Claude Code's answer wasn't in the expected format, so nothing was changed.",
    ),
  ).toBeInTheDocument();
  expect(cli.calls).toHaveLength(1);
  expect(cli.calls[0]?.provider).toBe("claude-cli");
  expect(JSON.parse(cli.calls[0]?.schema ?? "")).toHaveProperty("type");
  expect(await title()).toBe("Hello item");

  fake.queue(retitleOptions);
  await userEvent.click(screen.getByRole("button", { name: "Use OpenRouter" }));
  expect(await screen.findByText("Second idea")).toBeInTheDocument();
  expect(cli.calls).toHaveLength(1);
});

test("a failed Do shows its message in a toast with the error's actions", async () => {
  const { client } = await setup();
  await client.ai.settings.set.mutate({ defaultProvider: "claude-cli" });
  fakeCli(() => {
    throw new CliError("not_installed", "claude was not found");
  });
  await ask("give this a better title");
  await screen.findByText("Rename");
  await searched();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByText("Claude Code isn't installed on this computer."),
  ).toBeInTheDocument();
  const region = screen.getByRole("region", { name: /notification/i });
  expect(
    within(region).getByRole("button", { name: "Use OpenRouter" }),
  ).toBeInTheDocument();
  expect(
    within(region).getByRole("button", { name: "Open Settings" }),
  ).toBeInTheDocument();
  // The request does not stay pending on the server; it ends failed.
  await waitFor(async () => {
    const { entries } = await client.ai.log.list.query({});
    expect(entries[0]?.status).toBe("failed");
    expect(entries[0]?.errorCode).toBe("provider_unavailable");
  });
});

test("a CLI timeout ends the request failed with timeout", async () => {
  const { client } = await setup();
  await client.ai.settings.set.mutate({ defaultProvider: "claude-cli" });
  fakeCli(() => {
    throw new CliError("timeout", "timed out");
  });
  await ask("suggest a few titles");
  await screen.findByText("Rename");
  await searched();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByText(/^Claude Code didn't answer within \d+ seconds\.$/),
  ).toBeInTheDocument();
  await waitFor(async () => {
    const { entries } = await client.ai.log.list.query({});
    expect(entries[0]?.status).toBe("failed");
    expect(entries[0]?.errorCode).toBe("timeout");
  });
});

test("Cancel on a running Claude Code Do stops it and ends the request", async () => {
  const { client, title } = await setup();
  await client.ai.settings.set.mutate({ defaultProvider: "claude-cli" });
  let rejectRun: ((e: unknown) => void) | undefined;
  const cancelled: string[] = [];
  setCliRunnerForTests({
    run: () =>
      new Promise((_, reject) => {
        rejectRun = reject;
      }),
    status: async () => ({ installed: true, signedIn: true, version: "1" }),
    cancel: async (runId) => {
      cancelled.push(runId);
      rejectRun?.(new CliError("cancelled", "Cancelled"));
    },
  });
  await ask("give this a better title");
  await screen.findByText("Rename");
  await searched();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByText("Claude Code is working…"),
  ).toBeInTheDocument();
  await waitFor(() => expect(rejectRun).toBeDefined());
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  await waitFor(() =>
    expect(screen.queryByText("Claude Code is working…")).toBeNull(),
  );
  expect(cancelled).toHaveLength(1);
  await waitFor(async () => {
    const { entries } = await client.ai.log.list.query({});
    expect(entries[0]?.status).toBe("cancelled");
  });
  expect(await title()).toBe("Hello item");
});

test("on Home only answer is offered", async () => {
  await setup({ onHome: true });
  await ask("what's new?");
  expect(await screen.findByText("Answer")).toBeInTheDocument();
  expect(screen.getAllByRole("radio").map((r) => r.textContent)).toEqual([
    "Ask",
  ]);
});

test("text with no action words keeps the bar's own rows and ↵", async () => {
  const { client } = await setup({ onHome: true });
  await ask("hello");
  await screen.findByRole("group", { name: "Actions" });
  // Give the interpreter time to (not) show the row.
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.queryByText("Understood as")).toBeNull();
  expect(screen.queryByRole("radiogroup", { name: "Kind" })).toBeNull();
  await userEvent.keyboard("{Enter}");
  expect(await screen.findByText("Hello from Sample")).toBeInTheDocument();
  const { entries } = await client.ai.log.list.query({});
  expect(entries).toHaveLength(0);
});

test("two Dos run independently: Cancel on one leaves the other running", async () => {
  const { client, title } = await setup();
  await client.ai.settings.set.mutate({ defaultProvider: "claude-cli" });
  const runs = new Map<
    string,
    { resolve: (stdout: string) => void; reject: (e: unknown) => void }
  >();
  const order: string[] = [];
  const cancelled: string[] = [];
  setCliRunnerForTests({
    run: (req) =>
      new Promise((resolve, reject) => {
        order.push(req.runId);
        runs.set(req.runId, {
          resolve: (stdout) => resolve({ stdout, exitCode: 0 }),
          reject,
        });
      }),
    status: async () => ({ installed: true, signedIn: true, version: "1" }),
    cancel: async (runId) => {
      cancelled.push(runId);
      runs.get(runId)?.reject(new CliError("cancelled", "Cancelled"));
    },
  });
  for (const _ of [1, 2]) {
    await ask("give this a better title");
    await screen.findByText("Rename");
    await searched();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
  }
  await waitFor(() => expect(order).toHaveLength(2));
  const [first, second] = order as [string, string];
  const toasts = screen.getAllByText("Claude Code is working…");
  expect(toasts).toHaveLength(2);
  // Cancel the first Do from its own toast, wherever the queue placed it.
  const cancels = screen.getAllByRole("button", { name: "Cancel" });
  await userEvent.click(cancels[cancels.length - 1] as HTMLElement);
  expect(cancelled).toEqual([first]);
  await waitFor(() =>
    expect(screen.getAllByText("Claude Code is working…")).toHaveLength(1),
  );

  runs
    .get(second)
    ?.resolve(JSON.stringify({ structured_output: { title: "From second" } }));
  expect(
    await screen.findByText("Renamed to “From second”"),
  ).toBeInTheDocument();
  expect(await title()).toBe("From second");
  await waitFor(async () => {
    const { entries } = await client.ai.log.list.query({});
    expect(entries.map((e) => e.status).sort()).toEqual([
      "applied",
      "cancelled",
    ]);
  });
});

test("with an error shown, Tab moves focus to its actions", async () => {
  const { client } = await setup();
  await client.ai.settings.set.mutate({ defaultProvider: "claude-cli" });
  fakeCli(() => "not json at all");
  await ask("suggest a few titles");
  await screen.findByText("Rename");
  await searched();
  await userEvent.keyboard("{Enter}");
  await screen.findByText(
    "Claude Code's answer wasn't in the expected format, so nothing was changed.",
  );
  await userEvent.keyboard("{Tab}");
  expect(screen.getByRole("button", { name: "Try again" })).toHaveFocus();
});

test("a CLI that exits non-zero with no output shows its exit code", async () => {
  const { client } = await setup();
  await client.ai.settings.set.mutate({ defaultProvider: "claude-cli" });
  setCliRunnerForTests({
    run: async () => ({ stdout: "  \n", exitCode: 2 }),
    status: async () => ({ installed: true, signedIn: true, version: "1" }),
    cancel: async () => {},
  });
  await ask("suggest a few titles");
  await screen.findByText("Rename");
  await searched();
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByText(
      "Claude Code returned an error: exited with code 2.",
    ),
  ).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  await waitFor(async () => {
    const { entries } = await client.ai.log.list.query({});
    expect(entries[0]?.status).toBe("failed");
    expect(entries[0]?.errorCode).toBe("provider_error");
  });
});

test("on Home, ↵ opens a matching search result and asks no AI; ⌘↵ asks", async () => {
  const { client, fake } = await setup({ onHome: true });
  await client.sample.create.mutate({ title: "How to brew coffee" });

  fake.queue(JSON.stringify({ answer: "Grind, bloom, pour.", used: [] }));
  await ask("how to brew coffee");
  expect(await screen.findByText("Answer")).toBeInTheDocument();
  await screen.findByRole("option", { name: /How to brew coffee/ });
  // With rows listed, ↵ selects and mod+↵ asks AI.
  expect(screen.getByText("to ask AI").querySelector("kbd")).toHaveTextContent(
    isMac() ? "⌘↵" : "Ctrl ↵",
  );
  expect(screen.getByText("to select")).toBeInTheDocument();
  await modEnter();
  expect(await screen.findByText("Grind, bloom, pour.")).toBeInTheDocument();
  expect(fake.calls).toHaveLength(1);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

  await ask("how to brew coffee");
  await screen.findByText("Answer");
  await screen.findByRole("option", { name: /How to brew coffee/ });
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("heading", {
      name: "How to brew coffee",
      level: 1,
    }),
  ).toBeInTheDocument();
  expect(fake.calls).toHaveLength(1);
  expect((await client.ai.log.list.query({})).entries).toHaveLength(1);
});

test("on an item, ↵ opens a listed result row instead of running the request", async () => {
  const { client, fake, title } = await setup();
  await client.sample.create.mutate({ title: "Give this a better title" });
  await ask("give this a better title");
  await screen.findByText("Rename");
  await screen.findByRole("option", { name: /Give this a better title/ });
  // ↑↓ move through the rows, not the alternatives.
  await userEvent.keyboard("{ArrowDown}");
  expect(screen.getByText("Rename")).toBeInTheDocument();
  await userEvent.keyboard("{ArrowUp}");
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("heading", {
      name: "Give this a better title",
      level: 1,
    }),
  ).toBeInTheDocument();
  expect(fake.calls).toHaveLength(0);
  expect(await title()).toBe("Hello item");
});

test("the log records the interpreter only when its own pick ran", async () => {
  const { client, fake } = await setup();
  fake.queue(retitleOptions, retitleOptions);
  await ask("suggest a few titles");
  expect(await screen.findByRole("radio", { name: "Suggest" })).toBeChecked();
  await searched();
  await userEvent.keyboard("{Enter}");
  await screen.findByText("Second idea");
  await waitFor(async () => {
    const { entries } = await client.ai.log.list.query({});
    expect(entries[0]?.interpretedBy).toBe("keywords");
  });
  await userEvent.click(screen.getByRole("button", { name: "None of these" }));
  await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());

  // Tab picks the kind by hand: Do → Suggest.
  await ask("give this a better title");
  expect(await screen.findByRole("radio", { name: "Do" })).toBeChecked();
  await userEvent.keyboard("{Tab}");
  expect(screen.getByRole("radio", { name: "Suggest" })).toBeChecked();
  await searched();
  await userEvent.keyboard("{Enter}");
  await screen.findByText("Second idea");
  await waitFor(async () => {
    const { entries } = await client.ai.log.list.query({});
    expect(entries).toHaveLength(2);
    expect(entries[0]?.kind).toBe("suggest");
    expect(entries[0]?.interpretedBy).toBeNull();
  });
});

test("on Home, ↵ typed before search settles asks no AI; once rows arrive it opens one", async () => {
  const { client, fake } = await setup({ onHome: true });
  await client.sample.create.mutate({ title: "How to brew coffee" });
  fake.queue(JSON.stringify({ answer: "Grind, bloom, pour.", used: [] }));
  await ask("how to brew coffee");
  await screen.findByText("Answer");
  // The search is still debounced: no rows yet, so ↵ must wait for them.
  expect(
    screen.queryByRole("option", { name: /How to brew coffee/ }),
  ).toBeNull();
  expect(screen.getByText("to ask AI").querySelector("kbd")).toHaveTextContent(
    isMac() ? "⌘↵" : "Ctrl ↵",
  );
  await userEvent.keyboard("{Enter}");
  await screen.findByRole("option", { name: /How to brew coffee/ });
  expect(screen.queryByText("Grind, bloom, pour.")).toBeNull();
  expect(fake.calls).toHaveLength(0);
  expect((await client.ai.log.list.query({})).entries).toHaveLength(0);
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("heading", {
      name: "How to brew coffee",
      level: 1,
    }),
  ).toBeInTheDocument();
  expect(fake.calls).toHaveLength(0);
  expect((await client.ai.log.list.query({})).entries).toHaveLength(0);
});

test("on an item, ↵ typed before search settles does not run a Do", async () => {
  const { client, fake, title } = await setup();
  await client.sample.create.mutate({ title: "Rename budget" });
  fake.queue(JSON.stringify({ title: "Budget" }));
  await ask("rename budget");
  await screen.findByText("Rename");
  expect(screen.queryByRole("option", { name: /Rename budget/ })).toBeNull();
  await userEvent.keyboard("{Enter}");
  await screen.findByRole("option", { name: /Rename budget/ });
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(fake.calls).toHaveLength(0);
  expect((await client.ai.log.list.query({})).entries).toHaveLength(0);
  expect(await title()).toBe("Hello item");
  await userEvent.keyboard("{Enter}");
  expect(
    await screen.findByRole("heading", { name: "Rename budget", level: 1 }),
  ).toBeInTheDocument();
  expect(fake.calls).toHaveLength(0);
  expect(await title()).toBe("Hello item");
});

test("mod+↵ right after typing a matched request asks AI without waiting for search", async () => {
  const { client, fake } = await setup({ onHome: true });
  await client.sample.create.mutate({ title: "How to brew coffee" });
  fake.queue(JSON.stringify({ answer: "Grind, bloom, pour.", used: [] }));
  await ask("how to brew coffee");
  await screen.findByText("Answer");
  expect(
    screen.queryByRole("option", { name: /How to brew coffee/ }),
  ).toBeNull();
  await modEnter();
  expect(await screen.findByText("Grind, bloom, pour.")).toBeInTheDocument();
  expect(fake.calls).toHaveLength(1);
});

test("mod+↵ before the request is understood does nothing", async () => {
  const { client, fake } = await setup({ onHome: true });
  await client.sample.create.mutate({ title: "How to brew coffee" });
  const input = await ask("how to brew coffee");
  await screen.findByText("Answer");
  await screen.findByRole("option", { name: /How to brew coffee/ });
  // Clearing drops the guess; retyping lists the same rows before a new one.
  fireEvent.change(input, { target: { value: "" } });
  fireEvent.change(input, { target: { value: "how to brew coffee" } });
  expect(screen.queryByText("Understood as")).toBeNull();
  expect(
    screen.getByRole("option", { name: /How to brew coffee/ }),
  ).toBeInTheDocument();
  fireEvent.keyDown(input, {
    key: "Enter",
    metaKey: isMac(),
    ctrlKey: !isMac(),
  });
  // Let any navigation or request it started happen.
  await new Promise((r) => setTimeout(r, 100));
  expect(screen.getByRole("combobox")).toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "How to brew coffee", level: 1 }),
  ).toBeNull();
  expect(fake.calls).toHaveLength(0);
  expect((await client.ai.log.list.query({})).entries).toHaveLength(0);
});
