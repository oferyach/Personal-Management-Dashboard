import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { recordAudit } from "@/lib/audit";
import { can, type PermissionKey } from "@/lib/rbac";
import {
  resolveSessionState,
  revokeSession,
  sessionCookieName,
  type AuthenticatedUser,
  type SessionState,
} from "@/lib/sessions";

/**
 * The only bridge between Next.js and the session/authorization policy.
 *
 * Pages call `requirePageUser` / `requirePagePermission`. API routes call
 * `resolveApiUser`. Neither re-implements a rule: the rules live in
 * `src/lib/sessions.ts` and `src/lib/rbac.ts`.
 */

export const LOGIN_PATH = "/login";
export const SECURITY_PATH = "/settings/security";
export const FORBIDDEN_PATH = "/forbidden";

/** Cookie names Better Auth owns with `cookiePrefix: "pmd"` (measured in 1.2). */
const OWNED_SESSION_COOKIES = [sessionCookieName(), "pmd.session_data", "pmd.two_factor"] as const;

export async function sessionState(): Promise<SessionState> {
  const requestHeaders = await headers();
  return resolveSessionState(requestHeaders);
}

/**
 * A page user. Three authenticated states are possible and each renders a real,
 * different screen:
 *  - "ok"                    normal access
 *  - "mfa_required"         privileged role with no enrolled second factor (1.8)
 *  - "banned"               account blocked by an admin
 * In the last two the actor exists but `authorize()` refuses everything, so nothing
 * can be read or changed. Only a missing/expired session redirects to /login.
 */
export interface PageUser {
  user: AuthenticatedUser;
  state: "ok" | "mfa_required" | "banned";
}

export interface PageUserOptions {
  /**
   * The security settings page is the one place that may render while the account's
   * security is incomplete — otherwise the redirect to fix it would loop.
   */
  allowIncompleteSecurity?: boolean;
}

export async function requirePageUser(options: PageUserOptions = {}): Promise<PageUser> {
  const state = await sessionState();

  if (state.kind === "anonymous") redirect(LOGIN_PATH);

  const { user } = state;

  if (state.kind === "banned") return { user, state: "banned" };

  if (state.kind === "mfa_required") {
    if (!options.allowIncompleteSecurity) redirect(`${SECURITY_PATH}?reason=mfa`);
    return { user, state: "mfa_required" };
  }

  if (user.mustChangePassword) {
    // 1.7: an administrator-generated password must be replaced before anything else works.
    if (!options.allowIncompleteSecurity) redirect(`${SECURITY_PATH}?reason=password`);
    return { user, state: "ok" };
  }

  return { user, state: "ok" };
}

export async function requirePagePermission(
  permission: PermissionKey,
  options: PageUserOptions = {},
): Promise<PageUser> {
  const page = await requirePageUser(options);
  if (!(await can(page.user.actor, permission))) {
    recordAudit({
      action: "permission_denied",
      outcome: "denied",
      actorUserId: page.user.id,
      sessionId: page.user.session.id,
      detail: { scope: "page", permission },
    });
    redirect(FORBIDDEN_PATH);
  }
  return page;
}

/**
 * What a Server Action needs: who is asking, in which security state, and which
 * request headers (those headers are what `auth.api.*` reads the session from).
 *
 * A Server Action is a plain POST from a form; nothing about it is safe by
 * construction, so every action starts here. `banned` and `mfa_required` are
 * returned rather than redirected, because only the service layer can tell whether
 * the action is the way *out* of that state (enrolling MFA, replacing a
 * generated password) or must be refused.
 */
export interface ActionContext {
  user: AuthenticatedUser;
  state: "authenticated" | "mfa_required" | "banned";
  headers: Headers;
}

export async function actionContext(): Promise<ActionContext> {
  const requestHeaders = await headers();
  const state = await resolveSessionState(requestHeaders);
  if (state.kind === "anonymous") redirect(LOGIN_PATH);
  return { user: state.user, state: state.kind, headers: requestHeaders };
}

export type ApiActor =
  | { ok: true; user: AuthenticatedUser }
  | {
      ok: false;
      status: 401 | 403;
      code: "no_session" | "mfa_required" | "banned" | "missing_permission";
    };

/** The API guard: answers 401/403 as JSON instead of redirecting an XHR. */
export async function resolveApiUser(permission?: PermissionKey): Promise<ApiActor> {
  const state = await sessionState();

  if (state.kind === "anonymous") return { ok: false, status: 401, code: "no_session" };
  if (state.kind === "banned") return { ok: false, status: 403, code: "banned" };
  if (state.kind === "mfa_required") return { ok: false, status: 403, code: "mfa_required" };

  if (permission && !(await can(state.user.actor, permission))) {
    recordAudit({
      action: "permission_denied",
      outcome: "denied",
      actorUserId: state.user.id,
      sessionId: state.user.session.id,
      detail: { scope: "api", permission },
    });
    return { ok: false, status: 403, code: "missing_permission" };
  }

  return { ok: true, user: state.user };
}

export function unauthorizedJson(): Response {
  return Response.json({ error: "unauthenticated" }, { status: 401 });
}

export function forbiddenJson(permission: PermissionKey): Response {
  return Response.json({ error: "forbidden", permission }, { status: 403 });
}

/** Removes every session cookie Better Auth set. HttpOnly is kept; nothing is read client-side. */
export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const name of OWNED_SESSION_COOKIES) store.delete(name);
}

/**
 * Server-side sign-out (1.6). Works from a plain form POST, so signing out does not
 * need JavaScript, and the session row is deleted here rather than relying on the
 * client to call Better Auth's endpoint.
 */
export async function signOutCurrentSession(actorUserId?: string): Promise<void> {
  const state = await sessionState();
  if (state.kind !== "anonymous") {
    revokeSession(state.user.session.id);
    recordAudit({
      action: "sign_out",
      outcome: "success",
      actorUserId: actorUserId ?? state.user.id,
      sessionId: state.user.session.id,
      targetKind: "session",
      targetId: state.user.session.id,
    });
  }
  await clearSessionCookies();
}
