import { mkdirSync } from "node:fs";
import { randomBytes } from "node:crypto";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { getConfig } from "@/lib/env";
import { getLogger } from "@/lib/log";
import { schema } from "@/db/schema";

/**
 * The only place that opens SQLite. Repositories receive a handle from here;
 * nothing else in the codebase constructs a database connection (spec §13).
 */

type SqliteDb = Database.Database;

export const DB_PRAGMAS = {
  journalMode: "WAL",
  foreignKeys: 1,
  busyTimeoutMs: 5000,
  synchronous: "NORMAL",
} as const;

const SYNCHRONOUS_NAMES: Record<number, string> = { 0: "OFF", 1: "NORMAL", 2: "FULL", 3: "EXTRA" };

export interface DbHandle {
  sqlite: SqliteDb;
  db: BetterSQLite3Database<typeof schema>;
  file: string;
}

export interface DbDiagnostics {
  ok: boolean;
  file: string;
  journalMode: string;
  foreignKeys: boolean;
  busyTimeoutMs: number;
  synchronous: string;
  schemaVersion: number;
  tableCount: number;
  sqliteVersion: string;
}

interface Holder {
  entry: DbHandle;
  connections: number;
}

const globalHolder = globalThis as unknown as { __pmdDb?: Map<string, Holder> };

function holders(): Map<string, Holder> {
  if (!globalHolder.__pmdDb) globalHolder.__pmdDb = new Map<string, Holder>();
  return globalHolder.__pmdDb;
}

function applyPragmas(sqlite: SqliteDb): void {
  sqlite.pragma(`journal_mode = ${DB_PRAGMAS.journalMode}`);
  sqlite.pragma(`foreign_keys = ${DB_PRAGMAS.foreignKeys}`);
  sqlite.pragma(`busy_timeout = ${DB_PRAGMAS.busyTimeoutMs}`);
  sqlite.pragma(`synchronous = ${DB_PRAGMAS.synchronous}`);
  // Unique id helps diagnostics distinguish databases without storing any data.
  sqlite.pragma(`application_id = ${0x504d4442}`); // "PMDB"
}

export function openDatabase(file?: string): DbHandle {
  const env = getConfig();
  const target = file ?? env.paths.databaseFile;
  const existing = holders().get(target);
  if (existing) {
    existing.connections += 1;
    return existing.entry;
  }

  mkdirSync(/* turbopackIgnore: true */ env.paths.databaseDir, { recursive: true });

  const sqlite = new Database(target);
  applyPragmas(sqlite);
  const entry: DbHandle = { sqlite, db: drizzle(sqlite, { schema }), file: target };
  holders().set(target, { entry, connections: 1 });

  if (!env.isTest) {
    getLogger("db").info("database connected", {
      file: env.paths.databaseDisplay,
      journalMode: DB_PRAGMAS.journalMode,
    });
  }

  return entry;
}

export function getDb(): BetterSQLite3Database<typeof schema> {
  return openDatabase().db;
}

export function getSqlite(): SqliteDb {
  return openDatabase().sqlite;
}

export function closeDatabase(): void {
  const map = holders();
  for (const [file, holder] of map) {
    try {
      holder.entry.sqlite.close();
    } catch {
      // Already closed — nothing useful to do.
    }
    map.delete(file);
  }
}

/** Cheap, read-only, and honest: used by /api/v1/health and the status page. */
export function getDiagnostics(): DbDiagnostics {
  const env = getConfig();
  const base: DbDiagnostics = {
    ok: false,
    file: env.paths.databaseDisplay,
    journalMode: "unknown",
    foreignKeys: false,
    busyTimeoutMs: 0,
    synchronous: "unknown",
    schemaVersion: -1,
    tableCount: 0,
    sqliteVersion: "unknown",
  };

  try {
    const sqlite = getSqlite();

    base.journalMode = String(sqlite.pragma("journal_mode", { simple: true }));
    base.foreignKeys = Number(sqlite.pragma("foreign_keys", { simple: true })) === 1;
    base.busyTimeoutMs = Number(sqlite.pragma("busy_timeout", { simple: true }));
    const synchronousRaw = Number(sqlite.pragma("synchronous", { simple: true }));
    base.synchronous = SYNCHRONOUS_NAMES[synchronousRaw] ?? String(synchronousRaw);
    base.schemaVersion = Number(sqlite.pragma("user_version", { simple: true }));
    const versionRow = sqlite.prepare("SELECT sqlite_version() AS v").get() as
      { v: string } | undefined;
    base.sqliteVersion = versionRow?.v ?? "unknown";
    base.tableCount = (
      sqlite
        .prepare(
          "SELECT COUNT(*) AS c FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
        )
        .get() as { c: number }
    ).c;
    base.ok = true;
    return base;
  } catch (error) {
    getLogger("db").error("diagnostics failed", { error });
    base.ok = false;
    return base;
  }
}

/**
 * SQLite has no server-side auth; a randomly generated id is used by backups
 * and diagnostics to identify which database file a manifest belongs to.
 */
export function readDatabaseId(): string | null {
  const key = "db.instance_id";
  try {
    const sqlite = getSqlite();
    const row = sqlite.prepare("SELECT value FROM system_meta WHERE key = ?").get(key) as
      { value: string } | undefined;
    if (row) return row.value;
    const value = randomBytes(16).toString("hex");
    sqlite
      .prepare(
        "INSERT INTO system_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
      )
      .run(key, value, new Date().toISOString());
    return value;
  } catch {
    return null;
  }
}
