import "server-only";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { sessions as sessionsTable, two_factor, users } from "@/db/schema";
import { ActionError, noticeForAuthError } from "@/lib/actionError";
import { mustAllow } from "@/lib/actionGuard";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getLogger } from "@/lib/log";
import { MIN_PASSWORD_LENGTH, validatePasswordStrength } from "@/lib/passwords";
import type { ActionContext } from "@/lib/requestAuth";
import { stashOnce } from "@/lib/oneShot";
import { asBodyCall } from "@/lib/betterAuthCall";

/** ISO-8601 UTC, the project storage format (spec 13). */
function isoNow(): string {
  return new Date().toISOString();
}

/**
 * Account security service (work items 1.4, 1.5, 1.6, 1.7).
 *
 * The rule this file exists to enforce: a Server Action is a thin translator that
 * parses a form, calls `authorize()`, and hands the effect to Better Auth's own
 * endpoint through `auth.api.*` with the request's own cookies. Nothing here writes
 * a credential, a session row or a two-factor secret by hand — those belong to the
 * library's protocol (docs/adr/0001). What this file writes directly is only this
 * project's own column (`must_change_password`) and audit rows.
 *
 * A page may already have guarded the screen, but the guard is cosmetic: a forged
 * POST never renders a page. The check inside this file is the one that counts.
 *
 * Fresh-session note: the actions below that change a credential or a factor do not
 * add `requireFreshSession`, because each one sends the account password to Better
 * Auth, which verifies it against the Argon2id hash first. Requiring a fresh session
 * as well would block the very screen that fixes an account in the `mfa_required`
 * state, where the session is intentionally marked not-fresh.
 */

const log = getLogger("account-security");

/** Calls a Better Auth endpoint and turns its error into a form-safe notice code. */
async function viaAuth<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    const { notice, machineCode } = noticeForAuthError(error);
    log.warn("auth endpoint refused the request", { notice, machineCode });
    throw new ActionError(notice, machineCode);
  }
}

/** Keys of the one-shot store, exported so tests can assert what was shown and dropped. */
export const mfaUriKey = (userId: string) => `mfa:uri:${userId}`;
export const mfaCodesKey = (userId: string) => `mfa:codes:${userId}`;
export const tempPasswordKey = (userId: string) => `temp-password:${userId}`;

export interface MfaEnrollment {
  totpURI: string;
  /** The same secret in text form, for an authenticator app that asks for a key. */
  secret: string;
  backupCodes: string[];
}

export async function updateDisplayName(ctx: ActionContext, displayName: string): Promise<void> {
  await mustAllow(ctx, "profile.edit_own");

  const name = displayName.trim();
  if (name.length < 2 || name.length > 120) throw new ActionError("invalid_input", "NAME_LENGTH");

  await viaAuth(() => getAuth().api.updateUser({ headers: ctx.headers, body: { name } }));

  recordAudit({
    action: "account_updated",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "account",
    detail: { changed: "name" },
    headers: ctx.headers,
  });
}

/**
 * Own-password change (1.5). Needs the current password, then clears
 * `must_change_password` — an account created with an admin-generated password only
 * becomes "theirs" after this step (1.7). `must_change_password` is this project's
 * column, so clearing it here is ours to do.
 */
export async function changeOwnPassword(
  ctx: ActionContext,
  input: { currentPassword: string; newPassword: string; confirmPassword: string },
): Promise<void> {
  await mustAllow(ctx, "security.password_change_own");

  const problems = validatePasswordStrength(input.newPassword);
  if (problems.length > 0) throw new ActionError("password_policy", problems.join(","));
  if (input.newPassword !== input.confirmPassword) throw new ActionError("passwords_do_not_match");
  if (input.newPassword === input.currentPassword)
    throw new ActionError("password_policy", "UNCHANGED");

  await viaAuth(() =>
    getAuth().api.changePassword({
      headers: ctx.headers,
      body: { currentPassword: input.currentPassword, newPassword: input.newPassword },
    }),
  );

  getDb()
    .update(users)
    .set({ mustChangePassword: false, updatedAt: isoNow() })
    .where(eq(users.id, ctx.user.id))
    .run();

  recordAudit({
    action: "password_changed",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "account",
    sessionId: ctx.user.session.id,
    headers: ctx.headers,
  });
}

/**
 * Starts TOTP enrollment (1.6). Better Auth stores the secret encrypted in
 * `two_factor` with `verified = false` until the user proves they actually scanned
 * it; the URI and the backup codes are held only in this process, for one render.
 */
export async function beginMfaEnrollment(
  ctx: ActionContext,
  password: string,
): Promise<MfaEnrollment> {
  await mustAllow(ctx, "security.mfa_manage_own");

  const result = await viaAuth(() =>
    getAuth().api.enableTwoFactor({ headers: ctx.headers, body: { password } }),
  );

  const totpURI = (result as { totpURI?: string }).totpURI;
  const secret = totpURI ? new URL(totpURI).searchParams.get("secret") : null;
  const backupCodes = (result as { backupCodes?: string[] }).backupCodes ?? [];
  if (!totpURI || !secret) throw new ActionError("failed", "TOTP_URI_MISSING");

  stashOnce(mfaUriKey(ctx.user.id), [totpURI, secret]);
  stashOnce(mfaCodesKey(ctx.user.id), backupCodes);

  recordAudit({
    action: "two_factor_enrolled",
    outcome: "info",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "account",
    detail: { stage: "enrollment_started", methods: ["totp", "backup_code"] },
    headers: ctx.headers,
  });

  return { totpURI, secret, backupCodes };
}

/** An enrollment that was started but never confirmed (finish it, or cancel it). */
export function pendingMfaEnrollment(userId: string): boolean {
  const row = getDb()
    .select({ verified: two_factor.verified })
    .from(two_factor)
    .where(eq(two_factor.userId, userId))
    .get();
  return row ? row.verified === false : false;
}

/** Confirms the scanner really holds the secret; this is where two-factor turns on. */
export async function confirmMfaEnrollment(ctx: ActionContext, code: string): Promise<void> {
  await mustAllow(ctx, "security.mfa_manage_own");
  if (!/^\d{6}$/.test(code)) throw new ActionError("invalid_code", "CODE_FORMAT");

  await viaAuth(() => getAuth().api.verifyTOTP({ headers: ctx.headers, body: { code } }));

  recordAudit({
    action: "two_factor_enrolled",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "account",
    detail: { method: "totp" },
    headers: ctx.headers,
  });
}

/**
 * Abandons an unconfirmed enrollment.
 *
 * Measured 1.7.27: `/two-factor/disable` validates a body with `password` — sending
 * an empty body is refused with `VALIDATION_ERROR`. Abandoning a factor is a security
 * change like keeping one, so the password requirement is accepted rather than worked
 * around.
 */
export async function cancelMfaEnrollment(ctx: ActionContext, password: string): Promise<void> {
  await mustAllow(ctx, "security.mfa_manage_own");
  await viaAuth(() =>
    asBodyCall(getAuth().api.disableTwoFactor)({ headers: ctx.headers, body: { password } }),
  );
  recordAudit({
    action: "two_factor_disabled",
    outcome: "info",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "account",
    detail: { stage: "enrollment_cancelled" },
    headers: ctx.headers,
  });
}

/**
 * Turning MFA off (1.6). Needs the account password because for a privileged role
 * this is the one action that can lock the account out of privileged screens — it
 * must never be a stray click on a shared computer.
 */
export async function disableMfa(ctx: ActionContext, password: string): Promise<void> {
  await mustAllow(ctx, "security.mfa_manage_own");
  await viaAuth(() =>
    asBodyCall(getAuth().api.disableTwoFactor)({ headers: ctx.headers, body: { password } }),
  );
  recordAudit({
    action: "two_factor_disabled",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "account",
    headers: ctx.headers,
  });
}

/** New backup codes, readable once (1.6). The previous codes stop working. */
export async function regenerateBackupCodes(
  ctx: ActionContext,
  password: string,
): Promise<string[]> {
  await mustAllow(ctx, "security.mfa_manage_own");

  const result = await viaAuth(() =>
    asBodyCall(getAuth().api.generateBackupCodes)({ headers: ctx.headers, body: { password } }),
  );
  const codes = (result as { backupCodes?: string[] }).backupCodes ?? [];
  if (codes.length === 0) throw new ActionError("failed", "BACKUP_CODES_EMPTY");

  stashOnce(mfaCodesKey(ctx.user.id), codes);

  recordAudit({
    action: "backup_codes_generated",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "account",
    detail: { count: codes.length },
    headers: ctx.headers,
  });
  return codes;
}

/**
 * "Sign out everywhere" (1.4): Better Auth revokes every session of this account,
 * which is also how a stolen session is killed. The caller's own session goes with
 * them, so the caller must send the user back to the login page.
 */
export async function signOutEverywhere(ctx: ActionContext): Promise<void> {
  await mustAllow(ctx, "security.sessions_manage_own");
  await viaAuth(() => asBodyCall(getAuth().api.revokeSessions)({ headers: ctx.headers, body: {} }));
  recordAudit({
    action: "sessions_revoked_all",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "session",
    sessionId: ctx.user.session.id,
    headers: ctx.headers,
  });
}

/** Revokes one of the actor's own sessions by the id shown in the UI. */
export async function revokeOwnSession(ctx: ActionContext, sessionId: string): Promise<void> {
  await mustAllow(ctx, "security.sessions_manage_own");

  // Measured 1.7.27 shape: `/revoke-session` takes `{ token }`, not a session id.
  // Resolving id → token here also proves the session belongs to this actor.
  const target = getDb()
    .select({ token: sessionsTable.token, userId: sessionsTable.userId })
    .from(sessionsTable)
    .where(eq(sessionsTable.id, sessionId))
    .get();
  if (!target || target.userId !== ctx.user.id)
    throw new ActionError("forbidden", "SESSION_NOT_OWNED");

  await viaAuth(() =>
    getAuth().api.revokeSession({ headers: ctx.headers, body: { token: target.token } }),
  );

  recordAudit({
    action: "session_revoked",
    outcome: "success",
    actorUserId: ctx.user.id,
    targetUserId: ctx.user.id,
    targetKind: "session",
    targetId: sessionId,
    sessionId,
    headers: ctx.headers,
  });
}

/**
 * An administrator-generated temporary password (1.7). Not derived from anything
 * about the account, at least `MIN_PASSWORD_LENGTH`, and readable enough to be
 * handed over once by phone or in person.
 */
export function generateTemporaryPassword(): string {
  // No I/l/1/O/0: these passwords get read aloud or pasted from a chat window.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";
  for (let attempt = 0; attempt < 32; attempt += 1) {
    const bytes = randomBytes(20);
    const candidate = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]!).join("");
    // A digit is required so the value also satisfies a "must contain a number" policy.
    if (/[0-9]/.test(candidate) && candidate.length >= MIN_PASSWORD_LENGTH) return candidate;
  }
  throw new ActionError("failed", "TEMP_PASSWORD_GENERATION");
}
