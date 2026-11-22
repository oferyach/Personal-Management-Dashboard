import { afterAll, describe, expect, it } from "vitest";
import { GET } from "@/app/api/v1/health/route";
import { GET as LIVENESS_GET } from "@/app/health/route";
import { getSqlite } from "@/db/client";
import { readWorkerStatus } from "@/lib/health";
import { closeTestDatabases } from "../helpers/testDb";

/**
 * Integration level: the real route handler module, against a real SQLite file
 * created by the real migration runner (see setup-integration.ts).
 * The HTTP layer itself (Next server + security headers) is verified separately
 * in the Phase 0 gate with `next build` + `next start` + a live health request.
 */

describe("GET /api/v1/health", () => {
  it("reports 200 with measured database state", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const body = (await response.json()) as {
      status: string;
      time: string;
      uptimeSeconds: number;
      app: { nodeEnv: string; node: string };
      database: {
        ok: boolean;
        journalMode: string;
        foreignKeys: boolean;
        busyTimeoutMs: number;
        synchronous: string;
        tableCount: number;
        migrationsApplied: number;
        sqliteVersion: string;
      };
      worker: { state: string };
      integrations: { smtp: string; onedrive: string };
    };

    expect(body.status).toBe("ok");
    expect(body.app.nodeEnv).toBe("test");
    expect(body.database.ok).toBe(true);
    expect(body.database.journalMode).toBe("wal");
    expect(body.database.foreignKeys).toBe(true);
    expect(body.database.busyTimeoutMs).toBe(5000);
    expect(body.database.synchronous).toBe("NORMAL");
    expect(body.database.migrationsApplied).toBeGreaterThanOrEqual(1);
    expect(body.database.tableCount).toBeGreaterThanOrEqual(1);
    expect(body.database.sqliteVersion).toMatch(/^\d+\.\d+/);
    expect(body.worker.state).toBe("not_installed");
    expect(body.integrations).toEqual({ smtp: "not_configured", onedrive: "not_configured" });
  });

  it("does not disclose secrets or absolute host paths", async () => {
    const text = await (await GET()).text();

    for (const leak of [
      "SESSION_SECRET",
      "APP_ENCRYPTION_KEY",
      "sessionSecret",
      "encryptionKey",
      "session-secret",
    ]) {
      expect(text.toLowerCase()).not.toContain(leak.toLowerCase());
    }

    const body = JSON.parse(text) as { database: { file: string } };
    expect(body.database.file.startsWith("./")).toBe(true);
    expect(/^[a-z]:[\\/]/i.test(body.database.file)).toBe(false);
  });

  it("treats a fresh worker heartbeat as online and a stale one as degraded", async () => {
    const sqlite = getSqlite();
    const setHeartbeat = (value: string) =>
      sqlite
        .prepare(
          "INSERT INTO system_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run("worker:heartbeat", value, new Date().toISOString());
    const clearHeartbeat = () =>
      sqlite.prepare("DELETE FROM system_meta WHERE key = 'worker:heartbeat'").run();

    try {
      setHeartbeat(new Date().toISOString());
      const fresh = readWorkerStatus();
      expect(fresh.state).toBe("online");
      expect(fresh.heartbeatAgeSeconds !== null).toBe(true);
      expect((await GET()).status).toBe(200);

      setHeartbeat(new Date(Date.now() - 10 * 60 * 1000).toISOString());
      const stale = readWorkerStatus();
      expect(stale.state).toBe("stale");

      const staleResponse = await GET();
      expect(staleResponse.status).toBe(503);
      const staleBody = (await staleResponse.json()) as {
        status: string;
        worker: { state: string };
      };
      expect(staleBody.status).toBe("degraded");
      expect(staleBody.worker.state).toBe("stale");

      setHeartbeat("not-a-date");
      expect(readWorkerStatus().state).toBe("no_heartbeat");
      expect((await GET()).status).toBe(503);
    } finally {
      clearHeartbeat();
    }

    expect(readWorkerStatus().state).toBe("not_installed");
    expect((await GET()).status).toBe(200);
  });
});

describe("GET /health (container liveness alias)", () => {
  it("reports the same measured state as the versioned endpoint", async () => {
    const api = await GET();
    const liveness = await LIVENESS_GET();

    expect(liveness.status).toBe(api.status);
    expect(liveness.headers.get("content-type")).toContain("application/json");
    expect((await liveness.json()).status).toBe((await api.json()).status);
  });

  it("goes 503 when the measured state is degraded", async () => {
    const sqlite = getSqlite();
    sqlite
      .prepare(
        "INSERT INTO system_meta (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(
        "worker:heartbeat",
        new Date(Date.now() - 30 * 60 * 1000).toISOString(),
        new Date().toISOString(),
      );

    try {
      const response = await LIVENESS_GET();
      expect(response.status).toBe(503);
      expect(((await response.json()) as { status: string }).status).toBe("degraded");
    } finally {
      sqlite.prepare("DELETE FROM system_meta WHERE key = 'worker:heartbeat'").run();
    }

    expect((await LIVENESS_GET()).status).toBe(200);
  });
});

afterAll(() => {
  closeTestDatabases();
});
