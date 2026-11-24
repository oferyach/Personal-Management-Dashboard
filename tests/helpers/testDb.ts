import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { closeDatabase } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { resetEnvCache } from "@/lib/env";

/**
 * Test databases are real SQLite files with production pragmas, in .test-tmp/,
 * so integration tests exercise the same code paths production uses.
 */

export const testTmpDir = resolve(process.cwd(), ".test-tmp");
export const migrationsFolder = resolve(process.cwd(), "drizzle");

export function testDatabasePath(scope: string): string {
  return resolve(testTmpDir, `${scope}-${process.pid}.db`);
}

/** @types/node marks some known env keys read-only, so assignment goes through a map. */
function setEnv(values: Record<string, string>): void {
  const target = process.env as Record<string, string | undefined>;
  for (const [key, value] of Object.entries(values)) target[key] = value;
}

export function configureTestEnv(scope: string): void {
  setEnv({
    NODE_ENV: "test",
    LOG_LEVEL: "silent",
    DATABASE_PATH: testDatabasePath(scope),
    APP_URL: "http://127.0.0.1:4000",
    // Fixed test secrets: deterministic, obviously non-production, never reused.
    SESSION_SECRET: "test-session-secret-00000000000000000000000",
    APP_ENCRYPTION_KEY: "00112233445566778899aabbccddeeff00112233445566778899aabbccddeeff",
  });
  resetEnvCache();
}

/**
 * Tests use the production migration path — including the RBAC seed — so a
 * schema/seed problem can never appear in only one of the two worlds.
 */
export function applyMigrations(): void {
  const result = runMigrations();
  if (!result.ok) {
    throw new Error(`test database migrations failed: ${result.folder}`);
  }
}

export function resetTestDatabase(scope: string): void {
  closeDatabase();
  rmSync(testDatabasePath(scope), { force: true });
  rmSync(`${testDatabasePath(scope)}-wal`, { force: true });
  rmSync(`${testDatabasePath(scope)}-shm`, { force: true });
  configureTestEnv(scope);
  applyMigrations();
}

export function closeTestDatabases(): void {
  closeDatabase();
}
