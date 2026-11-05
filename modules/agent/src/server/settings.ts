import { implementOperation, type Tx } from "@dlh/server";
import { eq } from "drizzle-orm";
import { agentSettings } from "../db/schema";
import { agentOps } from "../operations";
import { type Settings, type SettingsView, settings } from "../schema";

type SettingsTableRow = typeof agentSettings.$inferSelect;

/** Settings as the API returns them: `max_cost_usd` (numeric, a string from the driver) as a number. */
function toSettings(row: SettingsTableRow): Settings {
  return settings.parse({
    defaultConnectionIds: row.defaultConnectionIds,
    maxParallel: row.maxParallel,
    maxRunningMinutes: row.maxRunningMinutes,
    maxCostUsd: Number(row.maxCostUsd),
    instructions: row.instructions,
    timeZone: row.timeZone,
  });
}

/** The one settings row, which the migration inserts; `lock` holds it for an update. */
export async function readSettings(
  tx: Pick<Tx, "select">,
  opts: { lock?: boolean } = {},
): Promise<Settings> {
  const q = tx.select().from(agentSettings).where(eq(agentSettings.id, 1));
  const [row] = opts.lock ? await q.for("update") : await q;
  if (!row) throw new Error("agent_settings has no row");
  return toSettings(row);
}

/** Writes the given settings and returns them all. */
export async function writeSettings(
  tx: Tx,
  patch: Partial<Settings>,
): Promise<Settings> {
  const { maxCostUsd, ...rest } = patch;
  const [row] = await tx
    .update(agentSettings)
    .set({
      ...rest,
      ...(maxCostUsd === undefined ? {} : { maxCostUsd: String(maxCostUsd) }),
    })
    .where(eq(agentSettings.id, 1))
    .returning();
  if (!row) throw new Error("agent_settings has no row");
  return toSettings(row);
}

export const settingsQuery = implementOperation(agentOps.settings, {
  async run(deps): Promise<SettingsView> {
    const [row] = await deps.db
      .select({ seen: agentSettings.workerSeenAt })
      .from(agentSettings)
      .where(eq(agentSettings.id, 1));
    return {
      ...(await readSettings(deps.db)),
      workerSeenAt: row?.seen?.toISOString() ?? null,
    };
  },
});

export const setSettings = implementOperation(agentOps.setSettings, {
  async run(w, input) {
    const before = await readSettings(w.tx, { lock: true });
    const result = await writeSettings(w.tx, input);
    return { result, undo: before };
  },
  async undo(w, before) {
    await writeSettings(w.tx, before);
  },
  undoRecord: settings,
});
