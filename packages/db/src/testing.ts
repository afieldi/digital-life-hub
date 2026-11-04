import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createDb,
  type Db,
  DEFAULT_DATABASE_URL,
  DEFAULT_TEST_DATABASE_URL,
} from "./client";
import { migrate } from "./migrate";
import { resetDatabase } from "./reset";

/** One migrations folder and the journal table it keeps (Core's by default). */
export type MigrationStep = { folder: string; table?: string };

/** Core's migrations: `packages/db/drizzle`. */
export const coreMigrations = (): string =>
  fileURLToPath(new URL("../drizzle", import.meta.url));

const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;

/** The same server and credentials as `url`, connected to the maintenance database. */
function adminUrl(url: string): string {
  const admin = new URL(DEFAULT_DATABASE_URL);
  const parsed = new URL(url);
  admin.protocol = parsed.protocol;
  admin.username = parsed.username;
  admin.password = parsed.password;
  admin.host = parsed.host;
  admin.pathname = "/postgres";
  return admin.toString();
}

/** `url` with another database name. */
function withDatabase(url: string, name: string): string {
  const u = new URL(url);
  u.pathname = `/${encodeURIComponent(name)}`;
  return u.toString();
}

/** A digest of the steps' migration files, so a changed migration gets a new template. */
function digest(steps: MigrationStep[]): string {
  const hash = createHash("sha256");
  for (const { folder, table } of steps) {
    hash.update(`${table ?? ""}\0`);
    const files = [
      ...readdirSync(folder)
        .filter((f) => f.endsWith(".sql"))
        .sort(),
      "meta/_journal.json",
    ];
    for (const f of files) {
      hash.update(`${f}\0`);
      hash.update(readFileSync(join(folder, f)));
    }
  }
  return hash.digest("hex").slice(0, 12);
}

/**
 * The template database with `steps` applied, built once per distinct set of
 * migration files (under a lock, so parallel test workers build it once).
 */
async function templateFor(
  base: string,
  steps: MigrationStep[],
): Promise<string> {
  const prefix = decodeURIComponent(new URL(base).pathname.slice(1));
  const name = `${prefix}_tpl_${digest(steps)}`;
  const admin = createDb(adminUrl(base));
  const conn = await admin.db.$client.reserve();
  try {
    await conn`select pg_advisory_lock(hashtext(${name}))`;
    if (!cleaned) {
      cleaned = true;
      const rows = await conn<{ datname: string }[]>`
        select datname from pg_database where datname like ${`${prefix}\\_%`}`;
      await dropOrphans(
        conn,
        rows.map((r) => r.datname),
        prefix,
      );
    }
    const [found] =
      await conn`select 1 from pg_database where datname = ${name}`;
    if (!found) {
      await conn.unsafe(`create database ${quote(name)}`);
      try {
        const url = withDatabase(base, name);
        for (const s of steps) {
          await migrate(url, s.folder, s.table ? { table: s.table } : {});
        }
      } catch (e) {
        await conn.unsafe(
          `drop database if exists ${quote(name)} with (force)`,
        );
        throw e;
      }
    }
    await conn`select pg_advisory_unlock(hashtext(${name}))`;
  } finally {
    conn.release();
    await admin.close();
  }
  return name;
}

let created = 0;
let cleaned = false;

/** Whether a process with this id runs on this machine. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** Drops the copies left by test processes that ended without closing them. */
async function dropOrphans(
  conn: { unsafe: (q: string) => Promise<unknown> },
  names: string[],
  prefix: string,
): Promise<void> {
  const copy = new RegExp(`^${prefix}_(\\d+)_\\d+$`);
  for (const name of names) {
    const pid = Number(copy.exec(name)?.[1]);
    if (pid && !alive(pid)) {
      await conn.unsafe(`drop database if exists ${quote(name)} with (force)`);
    }
  }
}

/**
 * A database of its own with `steps` applied, copied from a template so a
 * test needs no migration replay and test files can run in parallel. `close`
 * drops it.
 */
export async function freshDbFrom(steps: MigrationStep[]): Promise<{
  db: Db;
  url: string;
  close: () => Promise<void>;
}> {
  const base = process.env.TEST_DATABASE_URL ?? DEFAULT_TEST_DATABASE_URL;
  const template = await templateFor(base, steps);
  const name = `${template.replace(/_tpl_\w+$/, "")}_${process.pid}_${++created}`;
  const admin = createDb(adminUrl(base));
  try {
    // Copies of one template can't start while another session is on it.
    for (let attempt = 0; ; attempt++) {
      try {
        await admin.db.$client.unsafe(
          `create database ${quote(name)} template ${quote(template)}`,
        );
        break;
      } catch (e) {
        const busy = String(e).includes("is being accessed by other users");
        if (!busy || attempt >= 20) throw e;
        await new Promise((r) => setTimeout(r, 50 + attempt * 25));
      }
    }
  } finally {
    await admin.close();
  }
  const url = withDatabase(base, name);
  const { db, close } = createDb(url);
  return {
    db,
    url,
    close: async () => {
      await close();
      const a = createDb(adminUrl(base));
      try {
        await a.db.$client.unsafe(
          `drop database if exists ${quote(name)} with (force)`,
        );
      } finally {
        await a.close();
      }
    },
  };
}

/** A fresh test database with Core's migrations (see `freshDbFrom`). */
export function freshTestDb(
  /** Only for jsdom tests, where the default folder cannot be resolved from `import.meta.url`. */
  migrationsFolder?: string,
) {
  return freshDbFrom([{ folder: migrationsFolder ?? coreMigrations() }]);
}

/**
 * Wipes the database at `url` (creating it if missing) and applies `steps`, in
 * place: for a database a server keeps using, such as e2e's.
 */
export async function resetDbAt(
  url: string,
  steps: MigrationStep[],
): Promise<void> {
  const name = decodeURIComponent(new URL(url).pathname.slice(1));
  const admin = createDb(adminUrl(url));
  try {
    const [found] = await admin.db
      .$client`select 1 from pg_database where datname = ${name}`;
    if (!found) await admin.db.$client.unsafe(`create database ${quote(name)}`);
  } finally {
    await admin.close();
  }
  const [core, ...rest] = steps;
  await resetDatabase(url, core?.folder);
  for (const s of rest) {
    await migrate(url, s.folder, s.table ? { table: s.table } : {});
  }
}
