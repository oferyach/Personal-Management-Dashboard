import "server-only";
import { ActionError, type NoticeCode } from "@/lib/actionError";
import { recordAudit } from "@/lib/audit";
import { AuthorizationError, authorize, RbacConfigError, type PermissionKey } from "@/lib/rbac";
import type { ActionContext } from "@/lib/requestAuth";

/**
 * The single authorization call used by every Server Action (spec §12: permission
 * checks centralized in services).
 *
 * Why it is not enough that the page already checked: a Server Action is reachable
 * by a POST that never rendered a page. The page guard decides what a user can *see*;
 * this decides what a request may *do*.
 *
 * Two things happen here that a per-page check cannot:
 *  1. a banned account is refused even though its session row still exists;
 *  2. every refusal writes a `permission_denied` audit row with the permission that
 *     was asked for, so the Activity view shows attempts, not only successes.
 */

function noticeForDenial(reason: AuthorizationError["reason"]): NoticeCode {
  if (reason === "mfa_required") return "mfa_required";
  if (reason === "no_self_change") return "cannot_modify_self";
  if (reason === "role_too_high") return "not_assignable";
  if (reason === "stale_session") return "stale_session";
  return "forbidden";
}

export async function mustAllow(
  ctx: ActionContext,
  permission: PermissionKey,
  options: { requireFreshSession?: boolean } = {},
): Promise<void> {
  if (ctx.state === "banned") {
    deny(ctx, permission, "account_banned");
    throw new ActionError("account_deactivated", "account_banned");
  }

  try {
    await authorize(ctx.user.actor, permission, options);
  } catch (error) {
    if (error instanceof AuthorizationError) {
      deny(ctx, permission, error.reason);
      throw new ActionError(noticeForDenial(error.reason), error.reason);
    }
    if (error instanceof RbacConfigError) {
      deny(ctx, permission, "configuration_error");
      throw new ActionError("failed", "rbac_configuration");
    }
    throw error;
  }
}

function deny(ctx: ActionContext, permission: PermissionKey, reason: string): void {
  recordAudit({
    action: "permission_denied",
    outcome: "denied",
    actorUserId: ctx.user.id,
    sessionId: ctx.user.session.id,
    targetKind: "account",
    detail: { scope: "action", permission, reason },
    headers: ctx.headers,
  });
}
