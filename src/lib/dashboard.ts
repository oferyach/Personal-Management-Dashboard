import "server-only";
import { and, count, desc, eq, gte } from "drizzle-orm";

import { getDb } from "@/db/client";
import { audit_logs, sessions, users } from "@/db/schema";

/**
 * Real dashboard facts (work item 1.11 seed of what Phase 2 extends).
 * Every number here is a query against the live database; nothing is estimated,
 * cached from a previous build or invented.
 */
export interface DashboardFacts {
  activeSessions: number;
  lastSignInAt: string | null;
  signInAttemptsToday: number;
  accountsTotal: number;
  accountsByRole: { role: string; count: number }[];
  auditRowsToday: number;
}

function startOfUtcDay(): string {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  ).toISOString();
}

export function collectDashboardFacts(userId: string): DashboardFacts {
  const db = getDb();
  const nowIso = new Date().toISOString();

  const sessionsToday = db
    .select({ c: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), gte(sessions.expiresAt, nowIso)))
    .get();

  const lastSignIn = db
    .select({ createdAt: audit_logs.createdAt })
    .from(audit_logs)
    .where(and(eq(audit_logs.actorUserId, userId), eq(audit_logs.action, "sign_in")))
    .orderBy(desc(audit_logs.createdAt))
    .limit(1)
    .get();

  const dayStart = startOfUtcDay();

  const attempts = db
    .select({ c: count() })
    .from(audit_logs)
    .where(and(gte(audit_logs.createdAt, dayStart), eq(audit_logs.action, "sign_in")))
    .get();

  const total = db.select({ c: count() }).from(users).get();

  const byRole = db.select({ role: users.role, c: count() }).from(users).groupBy(users.role).all();

  const auditToday = db
    .select({ c: count() })
    .from(audit_logs)
    .where(gte(audit_logs.createdAt, dayStart))
    .get();

  return {
    activeSessions: sessionsToday?.c ?? 0,
    lastSignInAt: lastSignIn?.createdAt ?? null,
    signInAttemptsToday: attempts?.c ?? 0,
    accountsTotal: total?.c ?? 0,
    accountsByRole: byRole.map((row) => ({ role: String(row.role ?? "read_only"), count: row.c })),
    auditRowsToday: auditToday?.c ?? 0,
  };
}
