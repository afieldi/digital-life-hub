import { type AiSettings, aiSettings as aiSettingsShape } from "@dlh/core";
import { aiSettings, type Db } from "@dlh/db";
import { eq } from "drizzle-orm";

const DEFAULTS: AiSettings = {
  defaultProvider: "openrouter",
  openrouterModel: null,
  interpreter: "keywords",
};

/** The single `ai_settings` row, created with the defaults on first read. */
export async function getSettings(db: Db): Promise<AiSettings> {
  const read = () => db.select().from(aiSettings).where(eq(aiSettings.id, 1));
  let [row] = await read();
  if (!row) {
    await db.insert(aiSettings).values(DEFAULTS).onConflictDoNothing();
    [row] = await read();
  }
  if (!row) throw new Error("ai_settings row missing after insert");
  return aiSettingsShape.parse({
    defaultProvider: row.defaultProvider,
    openrouterModel: row.openrouterModel,
    interpreter: row.interpreter,
  });
}
