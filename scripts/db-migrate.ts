import { closeDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { getConfig, getEnvWarnings } from "@/lib/env";
import { configureLogging, getLogger, logStartupWarnings } from "@/lib/log";

/**
 * CLI wrapper around the single migration implementation in src/db/migrate.ts.
 *
 *   npm run db:migrate              development
 *   npm run db:migrate:deploy       container start / production upgrade path
 *
 * `--deploy` is strict: a missing migration folder is an error, not a warning,
 * so an upgrade can never silently skip migrations (spec §13, §20).
 */

const deploy = process.argv.includes("--deploy");
const env = getConfig();
configureLogging({ level: env.logLevel === "silent" ? "info" : env.logLevel });
const logger = getLogger("db:migrate");

function main(): void {
  logStartupWarnings(getEnvWarnings(), "db:migrate");

  const result = runMigrations();

  if (!result.ok) {
    if (deploy) {
      logger.error("migrations could not run; refusing to continue", { folder: result.folder });
      process.exitCode = 1;
    }
    return;
  }

  logger.info("migrations applied", {
    total: result.applied,
    durationMs: result.durationMs,
    database: env.paths.databaseDisplay,
    mode: deploy ? "deploy" : env.nodeEnv,
    roles: result.seed.rolesWritten,
    permissions: result.seed.permissionsWritten,
    grantsAdded: result.seed.grantsAdded,
    grantsRemoved: result.seed.grantsRemoved,
  });
}

try {
  main();
} catch (error) {
  logger.error("migration failed", { error });
  process.exitCode = 1;
} finally {
  closeDatabase();
}
