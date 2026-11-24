import { bootstrapState } from "@/lib/adminBootstrap";
import { closeDatabase, openDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { getConfig, getEnv, getEnvWarnings, secretReadiness } from "@/lib/env";
import { getLogger, logStartupWarnings } from "@/lib/log";

/**
 * Node-only server startup. Kept out of src/instrumentation.ts on purpose:
 * Next compiles the instrumentation entry for the Edge runtime too, and this
 * module deliberately uses process.exit, native SQLite and the filesystem.
 *
 * Fails closed (project ground rules + spec §19, §20):
 *   1. missing or placeholder production secrets
 *   2. an unopenable database
 *   3. missing or failing migrations in production
 *
 * There is no fallback that boots against an empty or mocked database, so a
 * broken deployment is loud instead of silently showing an empty dashboard.
 */

export interface StartupCheck {
  ok: boolean;
  issues: string[];
  migrationsApplied: number;
}

export function runStartupChecks(): StartupCheck {
  const issues: string[] = [];
  let migrationsApplied = 0;

  const readiness = secretReadiness();
  if (readiness.required && !readiness.ok) issues.push(...readiness.issues);

  try {
    openDatabase();
  } catch (error) {
    issues.push(
      `database could not be opened: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (issues.length === 0) {
    try {
      const migration = runMigrations();
      if (!migration.ok && getEnv().isProduction)
        issues.push(`migrations did not run: ${migration.folder}`);
      migrationsApplied = migration.applied;
    } catch (error) {
      issues.push(`migrations failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return { ok: issues.length === 0, issues, migrationsApplied };
}

export type ExitFn = (code: number) => void;

export function startServerRuntime(exit: ExitFn = (code) => process.exit(code)): void {
  const logger = getLogger("startup");

  // Nothing here may throw before the checks run: Next catches instrumentation
  // errors, logs them and keeps serving, which would turn a broken deployment
  // into a silent 500-generating server.
  logStartupWarnings(getEnvWarnings());

  const check = runStartupChecks();
  if (!check.ok) {
    logger.error("startup validation failed; refusing to start", { issues: check.issues });
    exit(1);
    return;
  }

  const env = getEnv(); // safe: runStartupChecks already validated secrets

  logger.info("server starting", {
    env: env.nodeEnv,
    port: env.port,
    database: env.paths.databaseDisplay,
    migrationsApplied: check.migrationsApplied,
    smtp: env.smtp ? "configured" : "not_configured",
    onedrive: env.onedrive ? "configured" : "not_configured",
    generatedThrowawayKeys: env.secretsWereGenerated,
  });

  // 1.3 startup guard. An install with accounts but nobody who can administer them is
  // a real state (an account was created, then its admin was demoted or blocked), and
  // it must be stated out loud rather than discovered by someone clicking a Users
  // link that renders nothing. Nothing here invents an account: no default credential
  // is created, and `authorize()` already refuses every privileged permission because
  // no account holds a privileged role.
  const install = bootstrapState();
  if (install.privilegedMissing) {
    logger.warn(
      "this install has accounts but no active privileged account: administration screens are unreachable until one exists (npm run admin:create -- --force --confirm)",
      { accounts: install.accounts, privilegedAccounts: install.privilegedAccounts },
    );
  }
}

/** Exposed for tests: release handles so a test process can move on cleanly. */
export function stopServerRuntime(): void {
  closeDatabase();
}

/** `next build` runs instrumentation in build workers with NODE_ENV=production. */
export function validateBuildConfiguration(): void {
  getConfig();
}
