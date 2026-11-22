import { existsSync } from "node:fs";
import { afterAll, describe, expect, it } from "vitest";
import {
  DB_PRAGMAS,
  closeDatabase,
  getDb,
  getDiagnostics,
  getSqlite,
  openDatabase,
} from "@/db/client";
import { testDatabasePath } from "../helpers/testDb";

describe("SQLite connection", () => {
  it("opens the configured file with production pragmas", () => {
    openDatabase();
    const diagnostics = getDiagnostics();

    expect(diagnostics.ok).toBe(true);
    expect(diagnostics.journalMode).toBe("wal");
    expect(diagnostics.foreignKeys).toBe(true);
    expect(diagnostics.busyTimeoutMs).toBe(DB_PRAGMAS.busyTimeoutMs);
    expect(diagnostics.synchronous).toBe("NORMAL");
    expect(diagnostics.sqliteVersion).toMatch(/^\d+\.\d+/);
  });

  it("reuses one connection per database file instead of opening per request", () => {
    const first = getSqlite();
    const again = getSqlite();
    expect(again).toBe(first);
    expect(getDb()).toBe(getDb());
  });

  it("creates the WAL sidecar on disk when writing", () => {
    const sqlite = getSqlite();
    sqlite.prepare("CREATE TABLE IF NOT EXISTS _wal_probe (value TEXT NOT NULL)").run();
    sqlite.prepare("INSERT INTO _wal_probe (value) VALUES (?)").run("written");

    const walFile = `${testDatabasePath("unit")}-wal`;
    expect(existsSync(walFile)).toBe(true);
    sqlite.prepare("DROP TABLE _wal_probe").run();
  });

  it("actually enforces foreign keys, not just the pragma flag", () => {
    const sqlite = getSqlite();
    sqlite.prepare("CREATE TABLE IF NOT EXISTS _fk_parent (id TEXT PRIMARY KEY)").run();
    sqlite
      .prepare(
        "CREATE TABLE IF NOT EXISTS _fk_child (id TEXT PRIMARY KEY, parent_id TEXT NOT NULL REFERENCES _fk_parent(id))",
      )
      .run();

    sqlite.prepare("INSERT INTO _fk_parent (id) VALUES (?)").run("parent-1");
    sqlite
      .prepare("INSERT INTO _fk_child (id, parent_id) VALUES (?, ?)")
      .run("child-1", "parent-1");

    expect(() =>
      sqlite
        .prepare("INSERT INTO _fk_child (id, parent_id) VALUES (?, ?)")
        .run("child-2", "missing"),
    ).toThrow(/FOREIGN KEY constraint failed/i);

    sqlite.prepare("DROP TABLE _fk_child").run();
    sqlite.prepare("DROP TABLE _fk_parent").run();
  });

  it("runs transactional writes atomically", () => {
    const sqlite = getSqlite();
    sqlite.prepare("CREATE TABLE IF NOT EXISTS _tx_probe (id TEXT PRIMARY KEY)").run();

    const insert = sqlite.prepare("INSERT INTO _tx_probe (id) VALUES (?)");
    try {
      sqlite.transaction(() => {
        insert.run("ok-1");
        insert.run("ok-1"); // duplicate primary key inside the transaction
      })();
    } catch {
      // expected
    }

    const count = (sqlite.prepare("SELECT COUNT(*) AS c FROM _tx_probe").get() as { c: number }).c;
    expect(count).toBe(0);

    sqlite.prepare("DROP TABLE _tx_probe").run();
  });
});

afterAll(() => {
  closeDatabase();
});
