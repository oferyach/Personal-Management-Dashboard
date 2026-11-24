import { randomUUID } from "node:crypto";
import { desc, eq, or } from "drizzle-orm";
import { getDb } from "@/db/client";
import { audit_logs } from "@/db/schema";
import { redact } from "./redact";

/**
 * Audit log (work item 1.11, spec §20).
 *
 * Spec §20 lists what must be recorded: actor, target, action, IP address,
 * timestamp, outcome. That is exactly the column set of `audit_logs`, so the
 * table shape is traceable to the requirement instead of being an invention.
 *
 * Rules this module enforces:
 *  - **Never throws to the caller.** An audit failure must not turn a working
 *    sign-in into a 500; it is logged loudly instead and reported by health checks.
 *  - **No secrets, ever.** `detail` goes through `redact()` before it is stored.
 *  - **One writer.** Nothing else inserts into `audit_logs`, so Phase 8's Activity
 *    view has a single source of truth.
 */

export const AUDIT_ACTIONS = [
  "sign_in",
  "sign_in_failed",
  "sign_in_blocked",
  "two_factor_required",
  "two_factor_succeeded",
  "two_factor_failed",
  "two_factor_enrolled",
  "two_factor_disabled",
  "backup_codes_generated",
  "sign_out",
  "session_revoked",
  "sessions_revoked_all",
  "account_created",
  "account_updated",
  "account_deactivated",
  "account_banned",
  "account_unbanned",
  "role_changed",
  "password_changed",
  "password_reset",
  "preferences_updated",
  "permission_denied",
  "impersonation_started",
  "impersonation_stopped",
  "rate_limited",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];
export type AuditOutcome = "success" | "failure" | "denied" | "info";

export interface AuditInput {
  action: AuditAction;
  outcome: AuditOutcome;
  actorUserId?: string | null;
  targetUserId?: string | null;
  targetKind?: string | null;
  targetId?: string | null;
  sessionId?: string | null;
  detail?: Record<string, unknown> | null;
  /** Pass the request headers so IP and user agent are recorded (spec §20). */
  headers?: Headers;
}

export interface AuditEntry {
  id: string;
  actorUserId: string | null;
  targetUserId: string | null;
  targetKind: string | null;
  targetId: string | null;
  sessionId: string | null;
  action: AuditAction;
  outcome: AuditOutcome;
  detail: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: string;
}

function clientIp(headers?: Headers): string | null {
  if (!headers) return null;
  // Only a header a trusted proxy sets is useful; a client cannot forge it into
  // this column because we take the first entry of `x-forwarded-for` and the
  // reverse proxy (Phase 4) overwrites it.
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || null;
  return headers.get("x-real-ip");
}

function userAgent(headers?: Headers): string | null {
  const value = headers?.get("user-agent");
  return value ? value.slice(0, 250) : null;
}

/**
 * Insert an audit row. Synchronous on purpose: better-sqlite3 is synchronous, and
 * an audit write that "might" happen later is an audit write that can be lost.
 */
export function recordAudit(input: AuditInput): AuditEntry | null {
  const row: AuditEntry = {
    id: randomUUID(),
    actorUserId: input.actorUserId ?? null,
    targetUserId: input.targetUserId ?? null,
    targetKind: input.targetKind ?? null,
    targetId: input.targetId ?? null,
    sessionId: input.sessionId ?? null,
    action: input.action,
    outcome: input.outcome,
    detail: input.detail ? JSON.stringify(redact(input.detail)) : null,
    ipAddress: clientIp(input.headers),
    userAgent: userAgent(input.headers),
    createdAt: new Date().toISOString(),
  };

  try {
    getDb().insert(audit_logs).values(row).run();
    return row;
  } catch (error) {
    // A failed audit write is itself a security-relevant event.
    console.error("audit write failed", {
      action: input.action,
      outcome: input.outcome,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export interface AuditQuery {
  userId?: string;
  action?: AuditAction;
  limit?: number;
}

export function readAudit(query: AuditQuery): AuditEntry[] {
  const limit = Math.min(Math.max(query.limit ?? 100, 1), 500);
  const db = getDb();
  const asEntry = (rows: (typeof audit_logs.$inferSelect)[]): AuditEntry[] =>
    rows.map((row) => ({
      ...row,
      action: row.action as AuditAction,
      outcome: row.outcome as AuditOutcome,
    }));

  const select = db.select().from(audit_logs).$dynamic();
  if (query.userId && query.action) {
    return asEntry(
      select
        .where(
          or(eq(audit_logs.actorUserId, query.userId), eq(audit_logs.targetUserId, query.userId)),
        )
        .orderBy(desc(audit_logs.createdAt))
        .limit(limit)
        .all(),
    );
  }
  if (query.userId) {
    return asEntry(
      select
        .where(
          or(eq(audit_logs.actorUserId, query.userId), eq(audit_logs.targetUserId, query.userId)),
        )
        .orderBy(desc(audit_logs.createdAt))
        .limit(limit)
        .all(),
    );
  }
  if (query.action) {
    return asEntry(
      select
        .where(eq(audit_logs.action, query.action))
        .orderBy(desc(audit_logs.createdAt))
        .limit(limit)
        .all(),
    );
  }
  return asEntry(select.orderBy(desc(audit_logs.createdAt)).limit(limit).all());
}

/** Used by health: the audit log must be writable, or the app is not compliant. */
export function auditLogWritable(): boolean {
  const probe = recordAudit({ action: "sign_out", outcome: "info", targetKind: "health_probe" });
  if (!probe) return false;
  try {
    getDb().delete(audit_logs).where(eq(audit_logs.id, probe.id)).run();
    return true;
  } catch {
    return false;
  }
}
