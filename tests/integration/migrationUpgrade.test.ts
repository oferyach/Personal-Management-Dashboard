import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { closeDatabase, getSqlite } from "@/db/client";
import { runMigrations } from "@/db/migrate";
import { closeTestDatabases, configureTestEnv, testDatabasePath } from "../helpers/testDb";

const scope = "phase0-upgrade";

afterEach(() => closeTestDatabases());

describe("append-only migration history", () => {
  it("upgrades an approved Phase 0 database without recreating system_meta", () => {
    configureTestEnv(scope);
    closeDatabase();
    rmSync(testDatabasePath(scope), { force: true });

    const phase0 = new Database(testDatabasePath(scope));
    phase0.exec(`
      CREATE TABLE system_meta (
        key text PRIMARY KEY NOT NULL,
        value text NOT NULL,
        updated_at text NOT NULL
      );
      CREATE TABLE __drizzle_migrations (
        id SERIAL PRIMARY KEY,
        hash text NOT NULL,
        created_at numeric
      );
      INSERT INTO __drizzle_migrations (hash, created_at)
      VALUES ('phase0-approved-baseline', 1795349404218);
      INSERT INTO system_meta (key, value, updated_at)
      VALUES ('app.schema_baseline', 'phase0', '2026-11-22T00:00:00.000Z');
    `);
    phase0.close();

    const result = runMigrations();
    expect(result.ok).toBe(true);
    // Every journal entry after the approved baseline: 0000 lean, 0001 identity,
    // 0002 productivity, 0003 events.
    expect(result.applied).toBe(4);

    const sqlite = getSqlite();
    const tables = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    expect(tables.map(({ name }) => name)).toContain("users");
    expect(tables.map(({ name }) => name)).toContain("two_factor");
    expect(tables.map(({ name }) => name)).toContain("events");
    expect(tables.map(({ name }) => name)).toContain("event_participants");

    const columns = sqlite.prepare("PRAGMA table_info(user_preferences)").all() as {
      name: string;
    }[];
    expect(columns.map(({ name }) => name)).toContain("theme");

    const baseline = sqlite
      .prepare("SELECT value FROM system_meta WHERE key = 'app.schema_baseline'")
      .get() as { value: string };
    expect(baseline.value).toBe("phase0");
  });
});
