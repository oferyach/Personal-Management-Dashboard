import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "@/db/client";
import { sessions, users } from "@/db/schema";
import type { RoleKey } from "@/db/schema/identity";
import { getConfig } from "./env";
import { getLogger } from "./log";
import type { Actor } from "./rbac";
import { isPrivilegedRole } from "./rbac";
import { getAuth } from "./auth";

/**
 * Session layer (work items 1.5, 1.6).
 *
 * The session *protocol* (cookie issuance, rotation, expiry, revocation) is
 * Better Auth's; this module only reads it and turns it into the application's
 * `Actor`. Keeping it in one place is what makes the "every request re-checks
 * the session, revocation takes effect immediately" rule (spec §12) testable.
 */

export interface SessionRecord {
  id: string;
  token: string;
  userId: string;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  ipAddress: string | null;
  userAgent: string | null;
  impersonatedBy: string | null;
}

export interface CurrentUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  emailVerified: boolean;
  role: RoleKey;
  banned: boolean;
  banReason: string | null;
  banExpires: string | null;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  onedriveLinked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AuthenticatedUser extends CurrentUser {
  session: SessionRecord;
  /** True when the session is inside the step-up window (spec §12 fresh-session rule). */
  sessionFresh: boolean;
  actor: Actor;
}

export type AuthFailureCode =
  "unauthenticated" | "session_expired" | "account_banned" | "mfa_required" | "role_missing";

export class AuthFailure extends Error {
  readonly code: AuthFailureCode;
  constructor(code: AuthFailureCode, message: string) {
    super(message);
    this.name = "AuthFailure";
    this.code = code;
  }
}

const log = getLogger("session");

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  if (typeof value === "number") return new Date(value).toISOString();
  return new Date().toISOString();
}

function isoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return iso(value);
}

/**
 * Reads the session row directly from the database.
 *
 * Why not `auth.api.getSession()` (which reads the cookie Better Auth mirrors for
 * speed)? Because the requirement says revocation must take effect "immediately"
 * (spec §12). Reading the table means a revoked or expired session can never be
 * honoured, even for the request that revoked it.
 */
export function readSessionByToken(
  token: string,
): { session: SessionRecord; user: CurrentUser } | null {
  const row = getDb()
    .select({
      sessionId: sessions.id,
      token: sessions.token,
      userId: sessions.userId,
      sessionExpiresAt: sessions.expiresAt,
      sessionCreatedAt: sessions.createdAt,
      sessionUpdatedAt: sessions.updatedAt,
      sessionIp: sessions.ipAddress,
      sessionUa: sessions.userAgent,
      impersonatedBy: sessions.impersonatedBy,
      name: users.name,
      email: users.email,
      image: users.image,
      emailVerified: users.emailVerified,
      role: users.role,
      banned: users.banned,
      banReason: users.banReason,
      banExpires: users.banExpires,
      twoFactorEnabled: users.twoFactorEnabled,
      mustChangePassword: users.mustChangePassword,
      onedriveLinked: users.onedriveLinked,
      userCreatedAt: users.createdAt,
      userUpdatedAt: users.updatedAt,
    })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(eq(sessions.token, token))
    .limit(1)
    .get();

  if (!row) return null;

  const session: SessionRecord = {
    id: row.sessionId,
    token: row.token,
    userId: row.userId,
    expiresAt: iso(row.sessionExpiresAt),
    createdAt: iso(row.sessionCreatedAt),
    updatedAt: iso(row.sessionUpdatedAt),
    ipAddress: row.sessionIp ?? null,
    userAgent: row.sessionUa ?? null,
    impersonatedBy: row.impersonatedBy ?? null,
  };

  const user: CurrentUser = {
    id: row.userId,
    name: row.name ?? null,
    email: row.email,
    image: row.image ?? null,
    emailVerified: Boolean(row.emailVerified),
    // A null role is treated as the least privileged role: fail closed.
    role: (row.role ?? "read_only") as RoleKey,
    banned: Boolean(row.banned),
    banReason: row.banReason ?? null,
    banExpires: isoOrNull(row.banExpires),
    twoFactorEnabled: Boolean(row.twoFactorEnabled),
    mustChangePassword: Boolean(row.mustChangePassword),
    onedriveLinked: Boolean(row.onedriveLinked),
    createdAt: iso(row.userCreatedAt),
    updatedAt: iso(row.userUpdatedAt),
  };

  return { session, user };
}

export function readSessionById(sessionId: string): SessionRecord | null {
  const row = getDb().select().from(sessions).where(eq(sessions.id, sessionId)).get();
  if (!row) return null;
  return {
    id: row.id,
    token: row.token,
    userId: row.userId,
    expiresAt: iso(row.expiresAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    impersonatedBy: row.impersonatedBy ?? null,
  };
}

/** Session token cookie name used by Better Auth with cookiePrefix "pmd". */
export const SESSION_COOKIE_NAME = "pmd.session_token";

export function sessionCookieName(): string {
  return SESSION_COOKIE_NAME;
}

/**
 * Resolves the current user from the request cookies.
 *
 * Two steps, and the split is the whole point:
 *
 *  1. **Better Auth verifies the credential.** `pmd.session_token` is not the session
 *     token; it is `<token>.<signature>` (measured, 1.2). Splitting it or comparing it
 *     against `sessions.token` by hand is a custom auth protocol, and it silently
 *     fails: a raw token matches the table but is rejected by Better Auth, while a
 *     real browser cookie is the opposite. So the cookie is handed to Better Auth's own
 *     `getSession`, which verifies the signature and returns the underlying token.
 *
 *  2. **The application re-reads the row.** The verified token is looked up in
 *     `sessions` here rather than trusting what Better Auth returns, because the
 *     requirement is that revocation takes effect immediately (spec §12): a session an
 *     administrator revoked a moment ago must not be honoured by a cached cookie, and
 *     the banned / MFA / freshness policy below is ours, not the library's.
 */
async function resolveFromRequest(
  headers: Headers,
): Promise<{ session: SessionRecord; user: CurrentUser } | null> {
  const resolved = await getAuth().api.getSession({ headers });
  const token = resolved?.session?.token;
  if (!token) return null;
  return readSessionByToken(token);
}

/**
 * Resolves the current user from the request cookies. Returns null when there is
 * no valid session; throws AuthFailure when a session exists but must not be
 * honoured (expired, banned, privileged role without MFA).
 */
export async function resolveAuthenticated(headers: Headers): Promise<AuthenticatedUser | null> {
  const found = await resolveFromRequest(headers);
  if (!found) return null;
  return toAuthenticated(found);
}

function toAuthenticated(found: {
  session: SessionRecord;
  user: CurrentUser;
}): AuthenticatedUser | null {
  const { session, user } = found;
  const now = Date.now();

  if (new Date(session.expiresAt).getTime() <= now) {
    getDb().delete(sessions).where(eq(sessions.id, session.id)).run();
    log.info("expired session removed", { sessionId: session.id });
    return null;
  }

  if (user.banned && (user.banExpires === null || new Date(user.banExpires).getTime() > now)) {
    throw new AuthFailure("account_banned", "This account is currently blocked.");
  }

  const cfg = getConfig().auth;
  if (cfg.privilegedRolesRequireMfa && isPrivilegedRole(user.role) && !user.twoFactorEnabled) {
    // Spec §12: privileged roles are denied until MFA is enrolled. The session
    // itself is still valid for signing out, which is why this is a distinct code.
    throw new AuthFailure("mfa_required", "Privileged accounts must enroll MFA before acting.");
  }

  const sessionFresh =
    now - new Date(session.createdAt).getTime() <= cfg.session.freshAgeSec * 1000;

  return {
    ...user,
    session,
    sessionFresh,
    actor: {
      userId: user.id,
      role: user.role,
      twoFactorEnabled: user.twoFactorEnabled,
      sessionFresh,
      impersonatedBy: session.impersonatedBy,
    },
  };
}

/**
 * The non-throwing form of `resolveAuthenticated`, used by the Next.js layer where
 * “who is asking” decides between a page redirect, a JSON 401 and a rendered
 * “enroll MFA / you are blocked” screen. The policy stays here so no page or route
 * invents its own rule.
 */
export type SessionState =
  | { kind: "anonymous" }
  | { kind: "authenticated"; user: AuthenticatedUser }
  /**
   * A real session for a privileged role with no enrolled second factor. The user is
   * returned so the UI can explain and fix it, but `authorize()` refuses every
   * permission for that actor (1.8), so it can read nothing and change nothing.
   */
  | { kind: "mfa_required"; user: AuthenticatedUser }
  | { kind: "banned"; user: AuthenticatedUser };

export async function resolveSessionState(headers: Headers): Promise<SessionState> {
  try {
    const user = await resolveAuthenticated(headers);
    return user ? { kind: "authenticated", user } : { kind: "anonymous" };
  } catch (error) {
    if (!(error instanceof AuthFailure)) throw error;

    // The session exists but the policy refuses it. The token is verified through
    // Better Auth again rather than parsed here, so the state screen can show who is
    // asking without treating an unverified cookie as an identity.
    const found = await resolveFromRequest(headers);
    if (!found) return { kind: "anonymous" };

    const limited: AuthenticatedUser = {
      ...found.user,
      session: found.session,
      sessionFresh: false,
      actor: {
        userId: found.user.id,
        role: found.user.role,
        twoFactorEnabled: found.user.twoFactorEnabled,
        sessionFresh: false,
        impersonatedBy: found.session.impersonatedBy,
      },
    };

    if (error.code === "mfa_required") return { kind: "mfa_required", user: limited };
    if (error.code === "account_banned") return { kind: "banned", user: limited };
    return { kind: "anonymous" };
  }
}

export function listUserSessions(userId: string): SessionRecord[] {
  const rows = getDb()
    .select()
    .from(sessions)
    .where(and(eq(sessions.userId, userId), isNull(sessions.impersonatedBy)))
    .all();
  return rows.map((row) => ({
    id: row.id,
    token: row.token,
    userId: row.userId,
    expiresAt: iso(row.expiresAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
    ipAddress: row.ipAddress ?? null,
    userAgent: row.userAgent ?? null,
    impersonatedBy: row.impersonatedBy ?? null,
  }));
}

/** Direct revocation. Better Auth's own endpoints do the same for user-initiated sign-out. */
export function revokeSession(sessionId: string): boolean {
  const result = getDb().delete(sessions).where(eq(sessions.id, sessionId)).run();
  return result.changes > 0;
}

export function revokeAllSessions(userId: string): number {
  const result = getDb().delete(sessions).where(eq(sessions.userId, userId)).run();
  return result.changes;
}

/** Used by tests and the CLI: create a session directly (never used by browser code). */
export function insertSessionDirect(userId: string): SessionRecord {
  const now = new Date();
  const cfg = getConfig().auth;
  const row = {
    id: randomUUID(),
    token: randomUUID() + randomUUID(),
    userId,
    expiresAt: new Date(now.getTime() + cfg.session.expiresInSec * 1000).toISOString(),
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ipAddress: null,
    userAgent: "internal",
    impersonatedBy: null,
  };
  getDb().insert(sessions).values(row).run();
  return row;
}
