import { closeDatabase, getDiagnostics, getSqlite } from "@/db/client";
import { getConfig } from "@/lib/env";
import { getHealthSnapshot } from "@/lib/health";
import { configureLogging, getLogger } from "@/lib/log";

/** Operator-facing summary: `npm run db:status`. Read-only, prints one record. */

const env = getConfig();
configureLogging({ level: env.logLevel });
const logger = getLogger("db:status");

function listTables(): Array<{ name: string; rows: number }> {
  const sqlite = getSqlite();
  const names = (
    sqlite
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
      )
      .all() as Array<{ name: string }>
  ).map((row) => row.name);

  return names.map((name) => {
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const count = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${quoted}`).get() as { c: number };
    return { name, rows: count.c };
  });
}

function main(): void {
  const diagnostics = getDiagnostics();
  const snapshot = getHealthSnapshot();

  logger.info("database status", {
    file: env.paths.databaseDisplay,
    ok: diagnostics.ok,
    journalMode: diagnostics.journalMode,
    foreignKeys: diagnostics.foreignKeys,
    busyTimeoutMs: diagnostics.busyTimeoutMs,
    synchronous: diagnostics.synchronous,
    userVersion: diagnostics.schemaVersion,
    sqliteVersion: diagnostics.sqliteVersion,
    migrationsApplied: snapshot.database.migrationsApplied,
    tables: listTables(),
    worker: snapshot.worker.state,
    integrations: snapshot.integrations,
  });
}

try {
  main();
} catch (error) {
  logger.error("database status failed", { error });
  process.exitCode = 1;
} finally {
  closeDatabase();
}
