import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import { closeDatabase } from "@/db/client";
import { resetEnvCache } from "@/lib/env";
import { runStartupChecks, startServerRuntime } from "@/lib/serverStart";
import { resetTestDatabase, testDatabasePath, testTmpDir } from "../helpers/testDb";

/**
 * Startup validation must fail loudly rather than boot an empty app
 * (project ground rules). Verified without killing the test process by calling
 * the same check function the real startup path uses.
 */

beforeEach(() => {
  resetEnvCache();
  resetTestDatabase("startup");
});
afterEach(() => {
  closeDatabase();
  resetEnvCache();
});

test("a valid isolated database passes startup checks and reports applied migrations", () => {
  process.env.DATABASE_PATH = testDatabasePath("startup");

  const check = runStartupChecks();

  expect(check.ok).toBe(true);
  expect(check.issues).toEqual([]);
  expect(check.migrationsApplied).toBeGreaterThanOrEqual(1);
});

test("startServerRuntime exits instead of serving when startup checks fail", () => {
  closeDatabase();

  const blocker = join(testTmpDir, "blocker-start");
  writeFileSync(blocker, "not a directory", "utf8");

  const env = process.env as Record<string, string | undefined>;
  const originalPath = env.DATABASE_PATH;
  env.DATABASE_PATH = join(blocker, "nested", "app.db");
  resetEnvCache();

  const exits: number[] = [];
  try {
    startServerRuntime((code) => exits.push(code));
    expect(exits).toEqual([1]);
  } finally {
    env.DATABASE_PATH = originalPath;
    resetEnvCache();
  }
});

test("startServerRuntime does not exit when the environment is valid", () => {
  process.env.DATABASE_PATH = testDatabasePath("startup");
  resetEnvCache();

  const exits: number[] = [];
  startServerRuntime((code) => exits.push(code));

  expect(exits).toEqual([]);
});

test("an unopenable database fails startup validation instead of booting empty", () => {
  closeDatabase(); // drop the healthy cached handle, otherwise nothing is re-opened

  const blocker = join(testTmpDir, "blocker");
  writeFileSync(blocker, "not a directory", "utf8");

  const env = process.env as Record<string, string | undefined>;
  const originalPath = env.DATABASE_PATH;
  env.DATABASE_PATH = join(blocker, "nested", "app.db");
  resetEnvCache();

  try {
    const check = runStartupChecks();

    expect(existsSync(join(testTmpDir, "nested"))).toBe(false);
    expect(check.ok).toBe(false);
    expect(check.migrationsApplied).toBe(0);
    expect(check.issues.join(" ")).toMatch(/database could not be opened/i);
  } finally {
    env.DATABASE_PATH = originalPath;
    resetEnvCache();
  }
});

test("production without secrets is reported as an issue, not silently accepted", () => {
  process.env.DATABASE_PATH = testDatabasePath("startup");

  const original = {
    NODE_ENV: process.env.NODE_ENV,
    SESSION_SECRET: process.env.SESSION_SECRET,
    APP_ENCRYPTION_KEY: process.env.APP_ENCRYPTION_KEY,
  };
  const env = process.env as Record<string, string | undefined>;
  env.NODE_ENV = "production";
  delete env.SESSION_SECRET;
  delete env.APP_ENCRYPTION_KEY;

  try {
    resetEnvCache();
    const check = runStartupChecks();
    expect(check.ok).toBe(false);
    expect(check.issues.join(" ")).toContain("SESSION_SECRET");
    expect(check.issues.join(" ")).toContain("APP_ENCRYPTION_KEY");
  } finally {
    env.NODE_ENV = original.NODE_ENV;
    if (original.SESSION_SECRET !== undefined) env.SESSION_SECRET = original.SESSION_SECRET;
    if (original.APP_ENCRYPTION_KEY !== undefined)
      env.APP_ENCRYPTION_KEY = original.APP_ENCRYPTION_KEY;
  }
});
