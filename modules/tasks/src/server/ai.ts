import { itemTitle } from "@dlh/core";
import {
  AiError,
  type AiRunner,
  type CoreDeps,
  defineAiRunner,
  itemContext,
  PREAMBLE,
  type RunnerTools,
} from "@dlh/server";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { tasksAiActions } from "../ai";
import { addDays, formatWhen, todayIn } from "../dates";
import { hasTaskParent } from "./links";
import { dueBetweenRows } from "./reads";
import { create, update } from "./writes";

/** Hand-written runners write through Core's tools, which `runApply` and `undo` always pass. */
function needTools(tools: RunnerTools | undefined): RunnerTools {
  if (!tools) throw new Error("Tasks AI runners need Core's RunnerTools");
  return tools;
}

function onScreen(ctx: { item: { id: string } | null }): string {
  if (!ctx.item) throw new Error("No task on screen");
  return ctx.item.id;
}

/** The task's own context, refused for a subtask: one level of subtasks only. */
async function topLevelTaskContext(deps: CoreDeps, itemId: string | null) {
  if (itemId && (await hasTaskParent(deps.db, itemId))) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Subtasks can't have subtasks",
    });
  }
  return itemContext(deps, itemId);
}

const breakDown = defineAiRunner(tasksAiActions.breakDown, {
  context: (deps, itemId) => topLevelTaskContext(deps, itemId),
  system: `${PREAMBLE}
Break the task into 3 to 7 concrete subtasks, each a short title that starts with a verb. Use the task's title and notes (the item's body); its links list the subtasks it already has ("contains"), so don't repeat them. When asked to suggest, give each subtask as an option with its title as the label. When asked to do it, list the titles in "subtasks".`,
  output: {
    do: z.object({ subtasks: z.array(itemTitle).min(3).max(7) }).strict(),
    suggest: z
      .object({
        options: z
          .array(z.object({ label: itemTitle }).strict())
          .min(3)
          .max(7),
      })
      .strict(),
  },
  /** Do creates every subtask; a suggestion creates the ticked ones, in one go. */
  async apply(_w, out, ctx, tools) {
    const { mutate } = needTools(tools);
    const parentId = onScreen(ctx);
    for (const title of titlesOf(out)) {
      await mutate(create, { title, parentId });
    }
    // Core soft-deletes the created subtasks on undo; nothing else to put back.
    return null;
  },
  async undo() {},
  summary(out) {
    const titles = titlesOf(out);
    return titles.length === 1
      ? `Added subtask “${titles[0]}”`
      : `Added ${titles.length} subtasks`;
  },
});

/** Do's `subtasks`, the ticked options of a suggestion, or one option. */
function titlesOf(out: unknown): string[] {
  if (Array.isArray(out)) return out.flatMap(titlesOf);
  const o = out as { subtasks?: string[]; label?: string };
  return o.subtasks ?? (o.label ? [o.label] : []);
}

const notes = z.string().max(10_000);
const rewriteUndo = z.object({ record: z.unknown() });

const rewriteNotes = defineAiRunner(tasksAiActions.rewriteNotes, {
  context: (deps, itemId) => itemContext(deps, itemId),
  system: `${PREAMBLE}
Rewrite the task's notes (the item's body) so they are clearer and easier to scan. Keep every fact and add none; keep the person's language. When asked to suggest, give exactly two versions, each with a short label saying how it differs. When asked to do it, give one version in "notes".`,
  output: {
    do: z.object({ notes }).strict(),
    suggest: z
      .object({
        options: z
          .array(
            z.object({ label: z.string().min(1).max(200), notes }).strict(),
          )
          .length(2),
      })
      .strict(),
  },
  async apply(_w, out, ctx, tools) {
    const { mutate } = needTools(tools);
    const { undo } = await mutate(update, {
      id: onScreen(ctx),
      expectedUpdatedAt: ctx.version,
      notes: (out as { notes: string }).notes,
    });
    return { record: undo.record };
  },
  async undo(_w, record, tools) {
    await needTools(tools).revert(update, rewriteUndo.parse(record).record);
  },
  summary: () => "Rewrote the notes",
});

/** At most this many tasks go to the model. */
const PLAN_LIMIT = 60;
/** Today and the next two days, after anything overdue. */
const PLAN_DAYS = 3;
const SINCE_EVER = "1970-01-01";

/** Open tasks overdue or due in the next `PLAN_DAYS` days, earliest first. */
async function planRows(deps: CoreDeps, timeZone: string) {
  const today = todayIn(deps.now(), timeZone);
  const rows = await dueBetweenRows(deps.db, {
    from: SINCE_EVER,
    to: addDays(today, PLAN_DAYS),
    timeZone,
    include: "open",
  });
  return { today, rows: rows.slice(0, PLAN_LIMIT) };
}

const planOutput = z
  .object({
    order: z
      .array(
        z.object({ taskId: z.uuid(), reason: z.string().max(200) }).strict(),
      )
      .max(20),
    advice: z.string().max(300),
  })
  .strict();

const planToday = defineAiRunner(tasksAiActions.planToday, {
  async context(deps, _itemId, opts) {
    const timeZone = opts?.timeZone ?? "UTC";
    const { today, rows } = await planRows(deps, timeZone);
    const lines = rows.map(({ row }) => {
      const when = row.due ? formatWhen(row.due, timeZone, today).text : "";
      const { total, done } = row.subtasks;
      const subtasks = total ? `${done}/${total} subtasks` : "no subtasks";
      return `- ${row.title} · ${when} · ${row.priority} · ${subtasks} (id ${row.id})`;
    });
    const text = lines.length
      ? `Open tasks, overdue first:\n${lines.join("\n")}`
      : "No open tasks are overdue or due in the next few days.";
    return { item: null, text, version: null, timeZone };
  },
  system: `${PREAMBLE}
The <item> section lists the person's open tasks that are overdue or due today or in the next two days, each with when it is due, its priority, its subtask progress and its id. Put the ones worth doing today in a sensible order, each with a one-sentence reason, and give one line of advice. Use only ids from the list.`,
  output: { ask: planOutput },
  async list(deps, out, ctx) {
    const { order, advice } = planOutput.parse(out);
    const { rows } = await planRows(deps, ctx.timeZone ?? "UTC");
    const byId = new Map(rows.map((r) => [r.row.id, r]));
    const seen = new Set<string>();
    const items = [];
    for (const { taskId } of order) {
      const found = byId.get(taskId);
      if (!found) {
        throw new AiError(
          "bad_output",
          "The plan named a task that isn't due soon, so nothing was shown.",
        );
      }
      if (seen.has(taskId)) continue;
      seen.add(taskId);
      items.push({
        id: found.row.id,
        type: "task",
        title: found.row.title,
        archivedAt: found.archivedAt,
      });
    }
    return { heading: advice.trim() || "Plan for today", items };
  },
});

export const tasksAiRunners: AiRunner[] = [breakDown, rewriteNotes, planToday];
