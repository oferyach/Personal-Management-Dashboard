import { getConfig } from "@/lib/env";
import { getDiagnostics, getSqlite } from "@/db/client";

/**
 * One health snapshot used by /api/v1/health, the status page, Docker
 * healthchecks and (from Phase 3) the worker liveness check.
 * Everything reported here is measured, never assumed.
 */

export interface WorkerStatus {
  state: "not_installed" | "online" | "stale" | "no_heartbeat";
  message: string;
  heartbeatAgeSeconds: number | null;
}

export interface HealthSnapshot {
  status: "ok" | "degraded";
  time: string;
  uptimeSeconds: number;
  app: { version: string; nodeEnv: string; node: string };
  database: {
    ok: boolean;
    file: string;
    journalMode: string;
    foreignKeys: boolean;
    busyTimeoutMs: number;
    synchronous: string;
    schemaVersion: number;
    tableCount: number;
    sqliteVersion: string;
    migrationsApplied: number;
  };
  worker: WorkerStatus;
  integrations: {
    smtp: "configured" | "not_configured";
    onedrive: "configured" | "not_configured";
  };
}

const startedAt = Date.now();

function readMeta(key: string): string | null {
  try {
    const row = getSqlite().prepare("SELECT value FROM system_meta WHERE key = ?").get(key) as
      { value: string } | undefined;
    return row?.value ?? null;
  } catch {
    return null;
  }
}

export function countMigrations(): number {
  try {
    const row = getSqlite().prepare("SELECT COUNT(*) AS c FROM __drizzle_migrations").get() as
      { c: number } | undefined;
    return row?.c ?? 0;
  } catch {
    // Table does not exist yet: migrations have not been applied.
    return 0;
  }
}

export function readWorkerStatus(): WorkerStatus {
  const heartbeat = readMeta("worker:heartbeat");
  if (!heartbeat) {
    return {
      state: "not_installed",
      message: "Background worker is introduced in Phase 3; no heartbeat table yet.",
      heartbeatAgeSeconds: null,
    };
  }

  const at = Date.parse(heartbeat);
  if (Number.isNaN(at)) {
    return {
      state: "no_heartbeat",
      message: "Heartbeat value is unreadable.",
      heartbeatAgeSeconds: null,
    };
  }

  const ageSeconds = Math.max(0, Math.round((Date.now() - at) / 1000));
  return ageSeconds <= 90
    ? { state: "online", message: "Worker heartbeat is fresh.", heartbeatAgeSeconds: ageSeconds }
    : {
        state: "stale",
        message: `No worker heartbeat for ${ageSeconds}s.`,
        heartbeatAgeSeconds: ageSeconds,
      };
}

export function getHealthSnapshot(): HealthSnapshot {
  const env = getConfig();
  const db = getDiagnostics();
  const migrationsApplied = countMigrations();
  const worker = readWorkerStatus();

  // A worker that is not installed yet (Phase 0-2) is informational.
  // Once Phase 3 installs it, a missing or stale heartbeat means reminders and
  // sync jobs are not running, which is a real degradation.
  const workerBlocking = worker.state === "stale" || worker.state === "no_heartbeat";
  const ok = db.ok && migrationsApplied > 0 && !workerBlocking;

  return {
    status: ok ? "ok" : "degraded",
    time: new Date().toISOString(),
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    app: {
      // Phase 6 wires a real build stamp (version + git sha) into the image.
      version: process.env.npm_package_version ?? "0.0.0-dev",
      nodeEnv: env.nodeEnv,
      node: process.version,
    },
    database: {
      ok: db.ok,
      file: db.file,
      journalMode: db.journalMode,
      foreignKeys: db.foreignKeys,
      busyTimeoutMs: db.busyTimeoutMs,
      synchronous: db.synchronous,
      schemaVersion: db.schemaVersion,
      tableCount: db.tableCount,
      sqliteVersion: db.sqliteVersion,
      migrationsApplied,
    },
    worker,
    integrations: {
      smtp: env.smtp ? "configured" : "not_configured",
      onedrive: env.onedrive ? "configured" : "not_configured",
    },
  };
}
