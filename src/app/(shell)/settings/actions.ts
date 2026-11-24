"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { ActionError, type NoticeCode } from "@/lib/actionError";
import { mustAllow } from "@/lib/actionGuard";
import { recordAudit } from "@/lib/audit";
import { isLocale, type Locale } from "@/i18n/locales";
import {
  beginMfaEnrollment,
  cancelMfaEnrollment,
  changeOwnPassword,
  confirmMfaEnrollment,
  disableMfa,
  regenerateBackupCodes,
  revokeOwnSession,
  signOutEverywhere,
  updateDisplayName,
} from "@/lib/accountSecurity";
import { getLogger } from "@/lib/log";
import {
  ALLOWED_REMINDER_OFFSETS,
  isTheme,
  PreferenceError,
  savePreferences,
} from "@/lib/preferences";
import { actionContext, signOutCurrentSession, type ActionContext } from "@/lib/requestAuth";

/**
 * Server Actions for the account screens (1.9). Plain HTML forms post here; there is
 * no client JavaScript on these pages, so every outcome travels back through the URL
 * as a code that the dictionary renders (`?notice=` / `?done=`) rather than as a
 * client toast.
 *
 * Two rules hold in every action:
 *   1. The permission is re-checked here, not only on the page. A POST to this file
 *      is a request like any other; a hidden button or a hand-built curl must not be
 *      able to do what a visible button can.
 *   2. Secrets returned by Better Auth (an otpauth URI, recovery codes) are handed to
 *      `src/lib/oneShot.ts` and are never placed in a URL, a cookie or the database.
 */

const PROFILE_PATH = "/settings/profile";
const SECURITY_PATH = "/settings/security";
const log = getLogger("settings-actions");

function formValue(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value.trim() : "";
}

function formNumber(formData: FormData, key: string): number | undefined {
  const value = formValue(formData, key);
  if (value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function redirectTo(path: string, params: Record<string, string>): never {
  const query = new URLSearchParams(params);
  revalidatePath(path);
  redirect(`${path}?${query.toString()}`);
}

/**
 * Runs one action, then redirects with the outcome. `ActionError` carries a user-safe
 * notice code; anything unexpected is logged and reported as the generic failure, so
 * a library message or a stack trace never reaches the browser (spec §18).
 */
async function run(
  path: string,
  work: (ctx: ActionContext) => Promise<{ done: string } | { notice: NoticeCode }>,
): Promise<never> {
  let outcome: { done: string } | { notice: NoticeCode };
  try {
    outcome = await work(await actionContext());
  } catch (error) {
    if (error instanceof ActionError) {
      outcome = { notice: error.notice };
    } else if (error instanceof PreferenceError) {
      log.warn("preference validation refused", { reason: error.message });
      outcome = { notice: "invalid_input" };
    } else {
      log.error("settings action failed", {
        error: error instanceof Error ? error.message : error,
      });
      outcome = { notice: "failed" };
    }
  }
  return redirectTo(path, outcome);
}

/* ------------------------------------------------------------------ profile */

export async function saveProfileAction(formData: FormData): Promise<never> {
  return run(PROFILE_PATH, async (ctx) => {
    await mustAllow(ctx, "settings.edit_own");

    const rawLanguage = formValue(formData, "language");
    if (rawLanguage !== "" && !isLocale(rawLanguage)) return { notice: "invalid_input" };
    const rawTheme = formValue(formData, "theme");
    if (rawTheme !== "" && !isTheme(rawTheme)) return { notice: "invalid_input" };

    const offsets = (key: string) =>
      formData
        .getAll(key)
        .map((value) => Number(value))
        .filter((value) => ALLOWED_REMINDER_OFFSETS.includes(value));

    savePreferences(ctx.user.id, {
      language: rawLanguage === "" ? null : (rawLanguage as Locale),
      timezone: formValue(formData, "timezone") || undefined,
      workweekDays: formNumber(formData, "workweekDays"),
      workdayStartHour: formNumber(formData, "workdayStartHour"),
      workdayEndHour: formNumber(formData, "workdayEndHour"),
      theme: isTheme(rawTheme) ? rawTheme : undefined,
      defaultTaskReminderOffsets: formData.has("defaultTaskReminderOffsets")
        ? offsets("defaultTaskReminderOffsets")
        : undefined,
      defaultCalendarReminderOffsets: formData.has("defaultCalendarReminderOffsets")
        ? offsets("defaultCalendarReminderOffsets")
        : undefined,
    });

    const name = formValue(formData, "name");
    if (name !== "") await updateDisplayName(ctx, name);

    recordAudit({
      action: "preferences_updated",
      outcome: "success",
      actorUserId: ctx.user.id,
      targetKind: "preferences",
      targetId: ctx.user.id,
      detail: { language: rawLanguage || "server_default", offsets: "reminder_defaults" },
      headers: ctx.headers,
    });

    return { done: "saved" };
  });
}

/* ----------------------------------------------------------------- security */

export async function changePasswordAction(formData: FormData): Promise<never> {
  return run(SECURITY_PATH, async (ctx) => {
    const current = formValue(formData, "currentPassword");
    const next = formValue(formData, "newPassword");
    const confirm = formValue(formData, "confirmPassword");
    if (!current || !next) return { notice: "invalid_input" };

    // The match/length rules live in the service, which is also the place a forged
    // POST reaches; checking them here as well only duplicates a rule.
    await changeOwnPassword(ctx, {
      currentPassword: current,
      newPassword: next,
      confirmPassword: confirm,
    });
    return { done: "passwordChanged" };
  });
}

export async function startMfaAction(formData: FormData): Promise<never> {
  return run(SECURITY_PATH, async (ctx) => {
    const password = formValue(formData, "password");
    if (!password) return { notice: "invalid_input" };
    await beginMfaEnrollment(ctx, password);
    return { done: "mfaStarted" };
  });
}

export async function confirmMfaAction(formData: FormData): Promise<never> {
  return run(SECURITY_PATH, async (ctx) => {
    const code = formValue(formData, "code");
    if (!code) return { notice: "invalid_input" };
    await confirmMfaEnrollment(ctx, code);
    return { done: "mfaEnabled" };
  });
}

export async function cancelMfaAction(formData: FormData): Promise<never> {
  return run(SECURITY_PATH, async (ctx) => {
    const password = formValue(formData, "password");
    if (!password) return { notice: "invalid_input" };
    await cancelMfaEnrollment(ctx, password);
    return { done: "mfaCancelled" };
  });
}

export async function regenerateCodesAction(formData: FormData): Promise<never> {
  return run(SECURITY_PATH, async (ctx) => {
    const password = formValue(formData, "password");
    if (!password) return { notice: "invalid_input" };
    await regenerateBackupCodes(ctx, password);
    return { done: "codesRegenerated" };
  });
}

export async function disableMfaAction(formData: FormData): Promise<never> {
  return run(SECURITY_PATH, async (ctx) => {
    const password = formValue(formData, "password");
    if (!password) return { notice: "invalid_input" };
    await disableMfa(ctx, password);
    return { done: "mfaDisabled" };
  });
}

export async function revokeOwnSessionAction(formData: FormData): Promise<never> {
  return run(SECURITY_PATH, async (ctx) => {
    const sessionId = formValue(formData, "sessionId");
    if (!sessionId) return { notice: "invalid_input" };
    await revokeOwnSession(ctx, sessionId);
    return { done: "sessionRevoked" };
  });
}

/**
 * "Sign out everywhere" (1.10): every session row of this account is revoked, the
 * current browser's cookies are cleared, and the user lands on the sign-in page.
 * It does not come back to a settings screen, because there is no session left.
 */
export async function signOutEverywhereAction(): Promise<never> {
  try {
    const ctx = await actionContext();
    await mustAllow(ctx, "security.sessions_manage_own");
    await signOutEverywhere(ctx);
    await signOutCurrentSession(ctx.user.id);
  } catch (error) {
    const notice = error instanceof ActionError ? error.notice : "failed";
    if (!(error instanceof ActionError)) {
      log.error("sign out everywhere failed", {
        error: error instanceof Error ? error.message : error,
      });
    }
    return redirectTo(SECURITY_PATH, { notice });
  }
  revalidatePath(SECURITY_PATH);
  redirect("/login?reason=signedOut");
}
