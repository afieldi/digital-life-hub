import {
  type AiProviderId,
  type AiSettings,
  aiSettings as aiSettingsShape,
} from "@dlh/core";
import { aiSettings, type Db } from "@dlh/db";
import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import type { AiDeps } from "./gateway";

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

const settingsPatch = aiSettingsShape.partial().strict();

/** Updates the given settings fields; an unknown provider or field is a BAD_REQUEST. */
export async function setSettings(
  db: Db,
  patch: unknown,
  now: Date,
): Promise<AiSettings> {
  const parsed = settingsPatch.safeParse(patch);
  if (!parsed.success) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: parsed.error.issues.map((i) => i.message).join("; "),
    });
  }
  await getSettings(db);
  const set = Object.fromEntries(
    Object.entries(parsed.data).filter(([, v]) => v !== undefined),
  );
  await db
    .update(aiSettings)
    .set({ ...set, updatedAt: now })
    .where(eq(aiSettings.id, 1));
  return getSettings(db);
}

export type ProviderStatus = {
  id: AiProviderId;
  available: boolean;
  reason?: "no_key";
};

/** Which providers the server can use; the CLIs run in the app, so always. */
export function providerStatus(deps: { ai: AiDeps }): ProviderStatus[] {
  const hasKey = deps.ai.providers.openrouter !== undefined;
  return [
    hasKey
      ? { id: "openrouter", available: true }
      : { id: "openrouter", available: false, reason: "no_key" },
    { id: "claude-cli", available: true },
    { id: "codex-cli", available: true },
  ];
}
