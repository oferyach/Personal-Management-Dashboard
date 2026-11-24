import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { getSqlite, openDatabase } from "@/db/client";
import { seedRbac, type SeedResult } from "@/db/seed/rbac";
import { getLogger } from "@/lib/log";

/**
 * One migration implementation for every caller (CLI, server startup, tests) —
 * there is no second, "simpler" migration path that could drift (spec §13).
 */

export function migrationsFolder(): string {
  return resolve(process.cwd(), "drizzle");
}

export interface MigrationResult {
  ok: boolean;
  applied: number;
  durationMs: number;
  folder: string;
  folderMissing: boolean;
  /** RBAC rows converged during this run. */
  seed: SeedResult;
}

function countApplied(): number {
  const row = getSqlite().prepare("SELECT COUNT(*) AS c FROM __drizzle_migrations").get() as
    { c: number } | undefined;
  return row?.c ?? 0;
}

function stampInstalledMarker(): void {
  const sqlite = getSqlite();
  const now = new Date().toISOString();
  const stmt = sqlite.prepare(
    "INSERT INTO system_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO NOTHING",
  );
  stmt.run("app.installed_at", now, now);
  stmt.run("app.schema_baseline", "phase0", now);
  stmt.run("app.migrations_last_run", now, now);
}

/**
 * Migrations and the RBAC seed are one step on purpose.
 *
 * `users.role` has a foreign key to `roles.key`, so an account can only be
 * created after the four roles exist. Making the seed part of the single
 * migration path means no caller (CLI, worker, test, container entrypoint) can
 * forget it and end up with a database where sign-up fails with an opaque
 * SQLITE_CONSTRAINT_FOREIGNKEY. `seedRbac()` is converging and idempotent, so
 * running it on every boot is safe.
 */
export function runMigrations(): MigrationResult {
  const logger = getLogger("db:migrate");
  const folder = migrationsFolder();

  if (!existsSync(folder)) {
    logger.warn(
      `Migration folder not found: ${folder}. Run "npm run db:generate" after changing src/db/schema (spec §13).`,
    );
    return {
      ok: false,
      applied: 0,
      durationMs: 0,
      folder,
      folderMissing: true,
      seed: { rolesWritten: 0, permissionsWritten: 0, grantsAdded: 0, grantsRemoved: 0 },
    };
  }

  const { db } = openDatabase();
  const started = Date.now();

  migrate(db, { migrationsFolder: folder });
  stampInstalledMarker();
  const seed = seedRbac();

  return {
    ok: true,
    applied: countApplied(),
    durationMs: Date.now() - started,
    folder,
    folderMissing: false,
    seed,
  };
}
