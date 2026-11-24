import "server-only";
import { count, eq, sql } from "drizzle-orm";

import { getDb } from "@/db/client";
import { sessions as sessionsTable, users } from "@/db/schema";
import type { RoleKey } from "@/db/schema/identity";
import { ActionError } from "@/lib/actionError";
import { mustAllow } from "@/lib/actionGuard";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { generateTemporaryPassword, tempPasswordKey } from "@/lib/accountSecurity";
import { getLogger } from "@/lib/log";
import { stashOnce } from "@/lib/oneShot";
import {
  activePrivilegedAccountCount,
  assertCanAssignRole,
  isPrivilegedRole,
  isRoleKey,
  roleDefinition,
} from "@/lib/rbac";
import type { ActionContext } from "@/lib/requestAuth";

/**
 * User administration service (work item 1.7).
 *
 * The read/write split is deliberate and documented:
 *
 *  - **Reads** are plain queries on this project's own tables, run by this service.
 *    A list of accounts is not an auth protocol, and the architecture boundary says
 *    the UI never touches `@/db` directly — the service does.
 *  - **Writes that change a credential, a factor, a role, a ban or a session** go to
 *    Better Auth's own endpoints through `auth.api.*` with the acting request's
 *    cookies. Re-implementing any of those would fork the protocol (spec §12 "no
 *    custom auth protocols") and would skip the library's own consent/lockout rules.
 *
 * Two invariants this file adds on top of the permission matrix, because a `true`
 * permission is not the same as a safe action:
 *  1. **No self-modification.** An admin who can deactivate, demote or password-reset
 *     their own account can lock themselves out of the install with one bad click.
 *  2. **Never remove the last way back in.** The last active privileged account
 *     cannot be demoted or deactivated, because there would be no account left that
 *     may administer users.
 */

const log = getLogger("user-administration");

/** ISO-8601 UTC, the project's storage format (spec §13). */
function isoNow(): string {
  return new Date().toISOString();
}

export interface ManagedUserRow {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  banned: boolean;
  banReason: string | null;
  createdAt: string;
  activeSessions: number;
}

export interface ManagedDirectory {
  users: ManagedUserRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Account list for the users screen (paginated, ordered by name). */
export function listManagedDirectory(limit = 50, offset = 0): ManagedDirectory {
  const size = Math.min(Math.max(Math.trunc(limit) || 1, 1), 200);
  const from = Math.max(Math.trunc(offset) || 0, 0);
  const db = getDb();

  const rows = db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      twoFactorEnabled: users.twoFactorEnabled,
      mustChangePassword: users.mustChangePassword,
      banned: users.banned,
      banReason: users.banReason,
      createdAt: users.createdAt,
      activeSessions:
        sql<number>`(select count(*) from ${sessionsTable} where ${sessionsTable.userId} = ${users.id} and ${sessionsTable.expiresAt} > ${isoNow()})`.as(
          "active_sessions",
        ),
    })
    .from(users)
    .orderBy(users.name, users.id)
    .limit(size)
    .offset(from)
    .all();

  const total = db.select({ c: count() }).from(users).get()?.c ?? 0;

  return {
    users: rows.map((row) => ({
      ...row,
      // `users.role` is a text column: anything the code does not know is rendered
      // as the least powerful role, and `authorize()` already refuses such an account.
      role: isRoleKey(row.role) ? row.role : "read_only",
      twoFactorEnabled: row.twoFactorEnabled === true,
      mustChangePassword: row.mustChangePassword === true,
      banned: row.banned === true,
    })),
    total,
    limit: size,
    offset: from,
  };
}

function requireTarget(ctx: ActionContext, userId: string): ManagedUserRow {
  const target = readTarget(userId);
  if (!target) throw new ActionError("account_not_found", "USER_NOT_FOUND");
  if (target.id === ctx.user.id) throw new ActionError("cannot_modify_self", "SELF_TARGET");
  return target;
}

function readTarget(userId: string): ManagedUserRow | null {
  const row = getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      twoFactorEnabled: users.twoFactorEnabled,
      mustChangePassword: users.mustChangePassword,
      banned: users.banned,
      banReason: users.banReason,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(eq(users.id, userId))
    .get();
  if (!row) return null;
  return {
    ...row,
    role: isRoleKey(row.role) ? row.role : "read_only",
    twoFactorEnabled: row.twoFactorEnabled === true,
    mustChangePassword: row.mustChangePassword === true,
    banned: row.banned === true,
    activeSessions: 0,
  };
}

/**
 * How many accounts could still administer this install. A privileged role with no
 * MFA enrolled is counted: it can still reach the security screen that enrolls MFA
 * (see `MFA_EXEMPT_PERMISSIONS` in `src/lib/rbac.ts`), so it is a way back in.
 */
export function activePrivilegedAccounts(): number {
  return activePrivilegedAccountCount();
}

function guardLastAdmin(ctx: ActionContext, target: ManagedUserRow): void {
  if (!isPrivilegedRole(target.role)) return;
  if (activePrivilegedAccounts() > 1) return;
  log.warn("refused to remove the last privileged account", {
    actor: ctx.user.id,
    target: target.id,
  });
  throw new ActionError("last_privileged_account", "LAST_PRIVILEGED_ACCOUNT");
}

/** Creating an account with a role above the actor would be a privilege escalation. */
function assertInitialRole(actorRole: RoleKey, targetRole: RoleKey): void {
  if (!isRoleKey(targetRole)) throw new ActionError("not_assignable", "UNKNOWN_ROLE");
  if (roleDefinition(targetRole).rank < roleDefinition(actorRole).rank) {
    throw new ActionError("not_assignable", "ROLE_ABOVE_ACTOR");
  }
}

export interface CreateManagedUserInput {
  name: string;
  email: string;
  role: RoleKey;
}

/**
 * Creates an account with an administrator-generated temporary password (1.7):
 * the value is returned to the caller once, held only in this process, and the
 * account carries `must_change_password` until the user replaces it.
 */
export async function createManagedUser(
  ctx: ActionContext,
  input: CreateManagedUserInput,
): Promise<{ user: ManagedUserRow; temporaryPassword: string }> {
  await mustAllow(ctx, "users.create");

  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2 || name.length > 120) throw new ActionError("invalid_input", "NAME_LENGTH");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    throw new ActionError("invalid_input", "EMAIL_FORMAT");
  }
  assertInitialRole(ctx.user.role, input.role);

  const temporaryPassword = generateTemporaryPassword();

  let created: unknown;
  try {
    created = await getAuth().api.createUser({
      headers: ctx.headers,
      body: { name, email, password: temporaryPassword, role: input.role },
    });
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    log.warn("account creation refused", { code });
    if (code === "USER_ALREADY_EXISTS" || code === "EMAIL_TAKEN") {
      throw new ActionError("email_taken", code);
    }
    throw new ActionError("failed", code ?? "CREATE_FAILED");
  }

  const createdUserId =
    (created as { user?: { id?: string } })?.user?.id ?? (created as { id?: string })?.id;
  if (!createdUserId) throw new ActionError("failed", "CREATE_RESULT_MISSING");

  // `must_change_password` is this project's column (default true), so making the
  // flag explicit for a generated password is ours to do.
  getDb()
    .update(users)
    .set({ mustChangePassword: true, updatedAt: isoNow() })
    .where(eq(users.id, createdUserId))
    .run();

  stashOnce(tempPasswordKey(createdUserId), [temporaryPassword]);

  recordAudit({
    action: "account_created",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: createdUserId,
    targetKind: "account",
    targetId: createdUserId,
    detail: { role: input.role, via: "admin", generated_password: true },
    headers: ctx.headers,
  });

  const row = readTarget(createdUserId);
  if (!row) throw new ActionError("failed", "CREATE_RESULT_MISSING");
  return { user: row, temporaryPassword };
}

/** Role change (1.3 + 1.7): dedicated permission, fresh session, audited, sessions rotated. */
export async function assignUserRole(
  ctx: ActionContext,
  userId: string,
  role: RoleKey,
): Promise<ManagedUserRow> {
  const target = requireTarget(ctx, userId);
  if (!isRoleKey(role)) throw new ActionError("not_assignable", "UNKNOWN_ROLE");

  try {
    await assertCanAssignRole(ctx.user.actor, role, userId);
  } catch (error) {
    const reason = (error as { reason?: string })?.reason;
    recordAudit({
      action: "permission_denied",
      outcome: "denied",
      actorUserId: ctx.user.id,
      sessionId: ctx.user.session.id,
      targetUserId: userId,
      targetKind: "account",
      detail: { scope: "action", permission: "roles.assign", reason: reason ?? "unknown" },
      headers: ctx.headers,
    });
    throw new ActionError(reason === "stale_session" ? "stale_session" : "not_assignable", reason);
  }

  if (target.role === role) throw new ActionError("invalid_input", "ROLE_UNCHANGED");
  guardLastAdmin(ctx, target);

  try {
    await getAuth().api.setRole({ headers: ctx.headers, body: { userId, role } });
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    throw new ActionError("not_assignable", code ?? "SET_ROLE_FAILED");
  }

  // A privilege change invalidates the target's sessions: 1.4's session-rotation rule
  // means a role change may never leave an old cookie with new powers.
  await revokeSessionsOf(ctx, userId, "role_changed");

  recordAudit({
    action: "role_changed",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: userId,
    targetKind: "account",
    targetId: userId,
    detail: { from: target.role, to: role },
    headers: ctx.headers,
  });

  return readTarget(userId) ?? target;
}

/** Deactivate / reactivate (1.7) — an account that may not sign in or act. */
export async function setAccountActive(
  ctx: ActionContext,
  userId: string,
  active: boolean,
  reason?: string,
): Promise<ManagedUserRow> {
  const target = requireTarget(ctx, userId);
  await mustAllow(ctx, "users.deactivate");
  if (!active) guardLastAdmin(ctx, target);

  try {
    if (active) {
      await getAuth().api.unbanUser({ headers: ctx.headers, body: { userId } });
    } else {
      await getAuth().api.banUser({
        headers: ctx.headers,
        body: { userId, banReason: reason?.trim().slice(0, 120) || "deactivated_by_admin" },
      });
    }
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    throw new ActionError("failed", code ?? "SET_ACTIVE_FAILED");
  }

  if (!active) await revokeSessionsOf(ctx, userId, "account_deactivated");

  recordAudit({
    action: active ? "account_unbanned" : "account_banned",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: userId,
    targetKind: "account",
    targetId: userId,
    detail: { active, reason: reason?.trim().slice(0, 120) ?? null },
    headers: ctx.headers,
  });

  return readTarget(userId) ?? target;
}

/** Kill every session of an account (1.4 + 1.7). */
export async function revokeUserSessions(ctx: ActionContext, userId: string): Promise<number> {
  const target = requireTarget(ctx, userId);
  await mustAllow(ctx, "users.revoke_sessions", { requireFreshSession: true });
  const revoked = await revokeSessionsOf(ctx, userId, "manual");
  recordAudit({
    action: "sessions_revoked_all",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: userId,
    targetKind: "session",
    targetId: userId,
    detail: { revoked, reason: "admin", targetRole: target.role },
    headers: ctx.headers,
  });
  return revoked;
}

async function revokeSessionsOf(
  ctx: ActionContext,
  userId: string,
  reason: string,
): Promise<number> {
  const before =
    getDb().select({ c: count() }).from(sessionsTable).where(eq(sessionsTable.userId, userId)).get()
      ?.c ?? 0;

  try {
    await getAuth().api.revokeUserSessions({ headers: ctx.headers, body: { userId } });
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    log.warn("session revocation refused", { userId, code, reason });
    throw new ActionError("failed", code ?? "REVOKE_FAILED");
  }

  const after =
    getDb().select({ c: count() }).from(sessionsTable).where(eq(sessionsTable.userId, userId)).get()
      ?.c ?? 0;

  return Math.max(before - after, 0);
}

/**
 * Admin password reset (1.7). The generated value is readable once (oneShot) and the
 * account is left with `must_change_password`, so a reset is never a way to keep
 * using a password the administrator chose on someone else's behalf.
 */
export async function resetUserPassword(
  ctx: ActionContext,
  userId: string,
): Promise<{ user: ManagedUserRow; temporaryPassword: string }> {
  const target = requireTarget(ctx, userId);
  await mustAllow(ctx, "users.reset_password", { requireFreshSession: true });

  const temporaryPassword = generateTemporaryPassword();

  try {
    await getAuth().api.setUserPassword({
      headers: ctx.headers,
      body: { userId, newPassword: temporaryPassword },
    });
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    throw new ActionError("failed", code ?? "SET_PASSWORD_FAILED");
  }

  getDb()
    .update(users)
    .set({ mustChangePassword: true, updatedAt: isoNow() })
    .where(eq(users.id, userId))
    .run();

  await revokeSessionsOf(ctx, userId, "password_reset");
  stashOnce(tempPasswordKey(userId), [temporaryPassword]);

  recordAudit({
    action: "password_reset",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: userId,
    targetKind: "account",
    targetId: userId,
    detail: { generated_password: true, must_change_password: true },
    headers: ctx.headers,
  });

  return { user: readTarget(userId) ?? target, temporaryPassword };
}
