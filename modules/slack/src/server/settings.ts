import { implementOperation, type Tx } from "@dlh/server";
import { eq } from "drizzle-orm";
import { slackSettings as table } from "../db/schema";
import { slackOps } from "../operations";
import { type SlackSettings, slackSettings } from "../schema";

/** The one settings row, which the migration inserts; `lock` holds it for an update. */
export async function readSettings(
  tx: Pick<Tx, "select">,
  opts: { lock?: boolean } = {},
): Promise<SlackSettings> {
  const q = tx.select().from(table).where(eq(table.id, 1));
  const [row] = opts.lock ? await q.for("update") : await q;
  if (!row) throw new Error("slack_settings has no row");
  return slackSettings.parse(row);
}

async function writeSettings(
  tx: Tx,
  patch: Partial<SlackSettings>,
): Promise<SlackSettings> {
  // An empty patch has nothing to set; reading it back is the same answer.
  if (Object.keys(patch).length === 0) return readSettings(tx);
  const [row] = await tx
    .update(table)
    .set(patch)
    .where(eq(table.id, 1))
    .returning();
  if (!row) throw new Error("slack_settings has no row");
  return slackSettings.parse(row);
}

export const settingsQuery = implementOperation(slackOps.settings, {
  run: (deps) => readSettings(deps.db),
});

export const setSettings = implementOperation(slackOps.setSettings, {
  async run(w, input) {
    const before = await readSettings(w.tx, { lock: true });
    const result = await writeSettings(w.tx, input);
    return { result, undo: before };
  },
  async undo(w, before) {
    await writeSettings(w.tx, before);
  },
  undoRecord: slackSettings,
});

export const botSettings = implementOperation(slackOps.botSettings, {
  async run(deps) {
    const { ownerSlackId, teamId, botUserId } = await readSettings(deps.db);
    return { ownerSlackId, teamId, botUserId };
  },
});
