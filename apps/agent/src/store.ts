import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { DatabaseSync as Database } from "node:sqlite";

/**
 * Loads node:sqlite without its one-off ExperimentalWarning (Node 22 prints it).
 * Only that warning is dropped; every other warning still reaches stderr.
 */
function loadSqlite(): typeof import("node:sqlite") {
  const emit = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    const text = typeof warning === "string" ? warning : warning.message;
    const type =
      typeof args[0] === "string"
        ? args[0]
        : (args[0] as { type?: string } | undefined)?.type;
    if (type === "ExperimentalWarning" && text.startsWith("SQLite")) return;
    return (emit as (...a: unknown[]) => void).call(process, warning, ...args);
  }) as typeof process.emitWarning;
  try {
    return createRequire(import.meta.url)("node:sqlite");
  } finally {
    process.emitWarning = emit;
  }
}

const NONCE_BYTES = 12;
const TAG_BYTES = 16;

export type ConnectionMeta = {
  id: string;
  name: string;
  type: string;
  scopeSummary: string;
};

export type Store = {
  addConnection(c: ConnectionMeta & { secret: Record<string, string> }): void;
  secretOf(id: string): Record<string, string>;
  /** Deletes the local secret; false when no connection has that name. */
  removeConnection(name: string): boolean;
  /** Metadata only: never the secrets. */
  listConnections(): ConnectionMeta[];
  markStarted(runId: string, volume: string): void;
  markEnded(runId: string, at: Date): void;
  /** Runs that ended before `at`, whose volumes can be removed. */
  endedBefore(at: Date): { runId: string; volume: string }[];
  forgetRun(runId: string): void;
  close(): void;
};

/** `nonce ‖ ciphertext ‖ tag`, base64. */
function seal(key: Buffer, value: string): string {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const body = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]).toString("base64");
}

function open(key: Buffer, sealed: string): string {
  try {
    const raw = Buffer.from(sealed, "base64");
    const nonce = raw.subarray(0, NONCE_BYTES);
    const tag = raw.subarray(raw.length - TAG_BYTES);
    const body = raw.subarray(NONCE_BYTES, raw.length - TAG_BYTES);
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    throw new Error(
      "Can't decrypt connection secrets: wrong AGENT_SECRETS_KEY",
    );
  }
}

/** Opens (creating if needed) `<dataDir>/agent.db`; secrets are AES-256-GCM sealed. */
export function openStore(dataDir: string, secretsKey: Buffer): Store {
  mkdirSync(dataDir, { recursive: true });
  const { DatabaseSync } = loadSqlite();
  const db: Database = new DatabaseSync(join(dataDir, "agent.db"));
  db.exec(`
    CREATE TABLE IF NOT EXISTS connections (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL,
      scope_summary TEXT NOT NULL,
      secret TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS runs (
      run_id TEXT PRIMARY KEY,
      volume TEXT NOT NULL,
      ended_at INTEGER
    );
  `);

  return {
    addConnection(c) {
      db.prepare(
        "INSERT INTO connections (id, name, type, scope_summary, secret) VALUES (?, ?, ?, ?, ?)",
      ).run(
        c.id,
        c.name,
        c.type,
        c.scopeSummary,
        seal(secretsKey, JSON.stringify(c.secret)),
      );
    },
    secretOf(id) {
      const row = db
        .prepare("SELECT secret FROM connections WHERE id = ?")
        .get(id) as { secret: string } | undefined;
      if (!row) throw new Error(`No local secret for connection ${id}`);
      return JSON.parse(open(secretsKey, row.secret)) as Record<string, string>;
    },
    removeConnection(name) {
      return (
        Number(
          db.prepare("DELETE FROM connections WHERE name = ?").run(name)
            .changes,
        ) > 0
      );
    },
    listConnections() {
      return (
        db
          .prepare(
            "SELECT id, name, type, scope_summary AS scopeSummary FROM connections ORDER BY name",
          )
          .all() as ConnectionMeta[]
      ).map((r) => ({ ...r }));
    },
    markStarted(runId, volume) {
      db.prepare(
        "INSERT OR REPLACE INTO runs (run_id, volume, ended_at) VALUES (?, ?, NULL)",
      ).run(runId, volume);
    },
    markEnded(runId, at) {
      db.prepare("UPDATE runs SET ended_at = ? WHERE run_id = ?").run(
        at.getTime(),
        runId,
      );
    },
    endedBefore(at) {
      return (
        db
          .prepare(
            "SELECT run_id AS runId, volume FROM runs WHERE ended_at IS NOT NULL AND ended_at < ? ORDER BY ended_at",
          )
          .all(at.getTime()) as { runId: string; volume: string }[]
      ).map((r) => ({ ...r }));
    },
    forgetRun(runId) {
      db.prepare("DELETE FROM runs WHERE run_id = ?").run(runId);
    },
    close() {
      db.close();
    },
  };
}
