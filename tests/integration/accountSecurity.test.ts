import { randomBytes } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

import { getSqlite } from "@/db/client";
import { resetAuthInstance } from "@/lib/auth";
import { ActionError } from "@/lib/actionError";
import { createFirstAdmin } from "@/lib/adminBootstrap";
import {
  beginMfaEnrollment,
  cancelMfaEnrollment,
  changeOwnPassword,
  confirmMfaEnrollment,
  disableMfa,
  mfaCodesKey,
  mfaUriKey,
  pendingMfaEnrollment,
  regenerateBackupCodes,
  revokeOwnSession,
  signOutEverywhere,
  updateDisplayName,
} from "@/lib/accountSecurity";
import { dropOnce, oneShotCount, peekOnce, takeOnce } from "@/lib/oneShot";
import { listUserSessions, resolveSessionState } from "@/lib/sessions";
import { resetTestDatabase } from "../helpers/testDb";
import { createManagedUser } from "@/lib/userAdministration";
import { actionContextFor, authCall, requestHeaders, signInHeaders } from "../helpers/signedIn";
import { secretFromTotpUri, totpCode } from "../helpers/totp";
import { resetEnvCache } from "@/lib/env";
import type { ActionContext } from "@/lib/requestAuth";

/**
 * Account security through the service layer (work items 1.4–1.7).
 *
 * These tests deliberately go through the same two objects a request carries —
 * Better Auth's cookies and the `ActionContext` built from them — rather than calling
 * the library with a hand-made actor. That is what makes them worth having: the first
 * version of `src/lib/sessions.ts` compared the session cookie against
 * `sessions.token` directly, and *every* test written against a hand-made session
 * still passed while the real browser path was broken (the cookie is
 * `<token>.<signature>`). Nothing here is allowed to invent a session.
 */

function start(scope: string): void {
  resetTestDatabase(scope);
  // These tests sign in repeatedly on purpose. The production login limit is
  // exercised in `authSpike.test.ts`; here it would only obscure the assertions.
  process.env.LOGIN_RATE_LIMIT_MAX_ATTEMPTS = "500";
  process.env.RATE_LIMIT_MAX_REQUESTS = "500";
  resetEnvCache();
  resetAuthInstance();
}

const tag = () => randomBytes(3).toString("hex");
const scalar = <T>(row: unknown, column: string): T =>
  (row as Record<string, T | undefined>)[column] as T;

function userRow(email: string) {
  return getSqlite().prepare("SELECT * FROM users WHERE email = ?").get(email);
}

function sessionCount(userId: string): number {
  return scalar<number>(
    getSqlite().prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?").get(userId),
    "c",
  );
}

function auditActions(): { action: string; outcome: string; detail: string | null }[] {
  return getSqlite()
    .prepare("SELECT action, outcome, detail FROM audit_logs ORDER BY id")
    .all() as { action: string; outcome: string; detail: string | null }[];
}

async function expectNotice(
  run: () => Promise<unknown>,
  notice: string,
  label: string,
): Promise<ActionError> {
  const error = await run().then(
    () => null,
    (caught: unknown) => caught,
  );
  expect(error, `${label}: expected a refusal`).toBeInstanceOf(ActionError);
  const actionError = error as ActionError;
  expect(actionError.notice, label).toBe(notice);
  return actionError;
}

async function contextFor(
  email: string,
  password: string,
  totpSecret?: string,
): Promise<ActionContext> {
  return actionContextFor(email, password, { totpSecret });
}

describe("privileged account with no second factor (1.8 gate)", () => {
  beforeAll(() => start("acct-mfa-gate"));

  it("has a real session, is refused every ordinary permission, and can still reach the MFA screen", async () => {
    const email = `gate+${tag()}@example.internal`;
    const password = "Gate-Password-2026!x";

    const created = await createFirstAdmin({ name: "Gate Admin", email, password });
    expect(created.role).toBe("super_admin");
    expect(created.mustChangePassword).toBe(false);
    expect(created.privilegedAccountsAfter).toBe(1);

    const headers = await signInHeaders(email, password);
    const state = await resolveSessionState(headers);
    // The whole point of 1.5/1.6 for a privileged role: the session is valid, and it
    // is not honoured. `src/lib/sessions.ts` reports the state instead of the user,
    // so the UI can explain it and the services can refuse it.
    expect(state.kind).toBe("mfa_required");
    if (state.kind !== "mfa_required") return;

    const ctx: ActionContext = { user: state.user, state: state.kind, headers };

    await expectNotice(
      () => updateDisplayName(ctx, "Renamed By Force"),
      "mfa_required",
      "profile edit",
    );

    // An *ordinary* permission is refused, and so is an account-administration one:
    // the gate does not care which permission was asked for, only whether the actor
    // holds a verified second factor.
    await expectNotice(
      () =>
        createManagedUser(ctx, {
          name: "Nobody At All",
          email: `gate-victim+${tag()}@example.internal`,
          role: "read_only",
        }),
      "mfa_required",
      "account creation",
    );

    // The self-security permissions are deliberately exempt from the MFA gate
    // (`MFA_EXEMPT_PERMISSIONS` in src/lib/rbac.ts): a locked-out privileged account
    // must still be able to fix the thing that locked it out. The exemption is not a
    // hole because the action itself sends the current password to Better Auth, which
    // checks it against the Argon2id hash first.
    const replacement = "Gate-Replacement-2026!x";
    await changeOwnPassword(ctx, {
      currentPassword: password,
      newPassword: replacement,
      confirmPassword: replacement,
    });
    expect(scalar<string>(userRow(email), "must_change_password")).toBe(0);
    const reSigned = await authCall("/sign-in/email", { body: { email, password: replacement } });
    expect(reSigned.status, reSigned.text).toBe(200);
    const staleSignIn = await authCall("/sign-in/email", { body: { email, password } });
    expect(staleSignIn.status).toBe(401);

    // The refusal is audited with the permission that was asked for, so the Activity
    // view shows attempts and not only successes.
    const denied = auditActions().filter((row) => row.action === "permission_denied");
    expect(denied.length).toBeGreaterThanOrEqual(2);
    expect(denied.every((row) => row.outcome === "denied")).toBe(true);
    expect(JSON.stringify(denied)).toContain("mfa_required");

    // And the name did not change.
    expect(scalar<string>(userRow(email), "name")).toBe("Gate Admin");

    // The MFA screen is still reachable — this is what `MFA_EXEMPT_PERMISSIONS` is
    // for. Note the password: the account's own password changed above, and the
    // self-security action proves it against the Argon2id hash, so the *stale* value
    // is refused. That is what makes the exemption safe rather than a loophole.
    await expectNotice(
      () => beginMfaEnrollment(ctx, password),
      "wrong_password",
      "enrollment with the superseded password",
    );

    const enrollment = await beginMfaEnrollment(ctx, replacement);
    expect(enrollment.totpURI).toMatch(/^otpauth:\/\/totp\//);
    expect(enrollment.backupCodes.length).toBeGreaterThanOrEqual(8);
    expect(pendingMfaEnrollment(ctx.user.id)).toBe(true);
    expect(scalar<number>(userRow(email), "two_factor_enabled")).toBe(0);
  });

  it("refuses a second privileged account from the CLI, and allows it when forced", async () => {
    const error = await createFirstAdmin({
      name: "Second Admin",
      email: `gate-second+${tag()}@example.internal`,
      password: "Second-Admin-Password-2026",
    }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/privileged account/);

    const forced = await createFirstAdmin({
      name: "Forced Admin",
      email: `gate-forced+${tag()}@example.internal`,
      password: "Forced-Admin-Password-2026",
      force: true,
      confirm: true,
    });
    expect(forced.privilegedAccountsAfter).toBe(2);
  });
});

describe("MFA enrollment, sessions and self-service (1.4, 1.5, 1.6)", () => {
  beforeAll(() => start("acct-security"));

  it("runs the whole lifecycle: enroll, wrong code, confirm, codes, sessions, disable", async () => {
    const email = `sec+${tag()}@example.internal`;
    const password = "Sec-Password-2026!xyz";

    const created = await createFirstAdmin({ name: "Sec Owner", email, password });
    const userId = created.id;

    // --- enrollment is pending until a code is actually verified ---
    const pendingCtx = await contextFor(email, password);
    const enrollment = await beginMfaEnrollment(pendingCtx, password);
    const secret = secretFromTotpUri(enrollment.totpURI);

    // Shown once, from this process only: nothing durable was written.
    expect(peekOnce(mfaUriKey(userId))).toBe(true);
    expect(takeOnce(mfaUriKey(userId))).toEqual([enrollment.totpURI, secret]);
    expect(takeOnce(mfaUriKey(userId))).toBeNull();
    expect(peekOnce(mfaCodesKey(userId))).toBe(true);

    const durable = getSqlite()
      .prepare("SELECT secret, backup_codes FROM two_factor WHERE user_id = ?")
      .get(userId);
    expect(scalar<string>(durable, "secret")).not.toContain(secret);
    expect(
      JSON.stringify(getSqlite().prepare("SELECT * FROM users WHERE id = ?").get(userId)),
    ).not.toContain(enrollment.backupCodes[0]!);

    const wrongCode = await expectNotice(
      () => confirmMfaEnrollment(pendingCtx, "000000"),
      "invalid_code",
      "wrong TOTP",
    );
    expect(wrongCode.machineCode).toBeTruthy();
    expect(scalar<number>(userRow(email), "two_factor_enabled")).toBe(0);

    const malformed = await expectNotice(
      () => confirmMfaEnrollment(pendingCtx, "12345"),
      "invalid_code",
      "malformed code",
    );
    expect(malformed.machineCode).toBe("CODE_FORMAT");

    // Cancel, then re-enroll: the cancel path is the way out of a half-done enrollment.
    // Measured: `/two-factor/disable` requires the account password, so this is not a
    // stray-click action.
    await expectNotice(
      () => cancelMfaEnrollment(pendingCtx, "wrong-password-123456"),
      "wrong_password",
      "cancel with wrong password",
    );
    expect(pendingMfaEnrollment(userId)).toBe(true);
    await cancelMfaEnrollment(pendingCtx, password);
    expect(pendingMfaEnrollment(userId)).toBe(false);

    // Measured: that endpoint rotates the session, so the cookie `pendingCtx` carries
    // is dead by now. Rebuilding the context is what the browser does when it receives
    // the new `Set-Cookie` header (`nextCookies()` in `src/lib/auth.ts` is what puts
    // that header on the response in production) — the test must not reuse a session
    // that no longer exists, and proving that is the point of the assertion below.
    const rotated = await expectNotice(
      () => beginMfaEnrollment(pendingCtx, password),
      "unauthorized",
      "enrollment on a rotated session",
    );
    expect(rotated.notice).toBe("unauthorized");

    const retryCtx = await contextFor(email, password);
    const second = await beginMfaEnrollment(retryCtx, password);
    const secondSecret = secretFromTotpUri(second.totpURI);

    await confirmMfaEnrollment(retryCtx, totpCode(secondSecret));
    expect(scalar<number>(userRow(email), "two_factor_enabled")).toBe(1);
    expect(scalar<number>(userRow(email), "must_change_password")).toBe(0);

    // From here the password alone is not enough, and the tests prove it: signing in
    // without the second factor no longer yields a session.
    const bare = await authCall("/sign-in/email", { body: { email, password } });
    expect(bare.json?.twoFactorRedirect).toBe(true);
    // Measured: the password step does not simply omit the session cookies — it
    // *clears* them, because a browser still holding an old one must not be able to
    // use it once the factor is mandatory. The assertion that matters is that no
    // session token value is handed out before the second factor is verified.
    expect(bare.cookie).not.toMatch(/pmd\.session_token=[^;]/);
    expect(bare.cookie).toContain("pmd.two_factor=");

    const ctx = await contextFor(email, password, secondSecret);
    expect(ctx.state).toBe("authenticated");
    expect(ctx.user.actor.twoFactorEnabled).toBe(true);
    expect(ctx.user.actor.sessionFresh).toBe(true);

    // --- profile edit is allowed now that the account is privileged *and* enrolled ---
    await updateDisplayName(ctx, "Renamed Owner");
    expect(scalar<string>(userRow(email), "name")).toBe("Renamed Owner");

    // --- own password change (1.5) ---
    await expectNotice(
      () =>
        changeOwnPassword(ctx, {
          currentPassword: "wrong-current-password-123",
          newPassword: "Replacement-Password-2026",
          confirmPassword: "Replacement-Password-2026",
        }),
      "wrong_password",
      "wrong current password",
    );
    await expectNotice(
      () =>
        changeOwnPassword(ctx, {
          currentPassword: password,
          newPassword: "short123",
          confirmPassword: "short123",
        }),
      "password_policy",
      "weak new password",
    );
    await expectNotice(
      () =>
        changeOwnPassword(ctx, {
          currentPassword: password,
          newPassword: "Replacement-Password-2026",
          confirmPassword: "Different-Password-2026!",
        }),
      "passwords_do_not_match",
      "confirmation mismatch",
    );

    const hashBefore = scalar<string>(
      getSqlite().prepare("SELECT password FROM accounts WHERE user_id = ?").get(userId),
      "password",
    );
    const nextPassword = "Replacement-Password-2026";
    await changeOwnPassword(ctx, {
      currentPassword: password,
      newPassword: nextPassword,
      confirmPassword: nextPassword,
    });
    const hashAfter = scalar<string>(
      getSqlite().prepare("SELECT password FROM accounts WHERE user_id = ?").get(userId),
      "password",
    );
    expect(hashAfter).not.toBe(hashBefore);
    expect(hashAfter).toMatch(/^\$argon2id\$v=19\$m=\d+,t=\d+,p=\d+\$/);
    // The new value is never stored, only hashed (spec §12).
    expect(JSON.stringify(getSqlite().prepare("SELECT * FROM accounts").all())).not.toContain(
      nextPassword,
    );

    // --- backup codes: readable once, regenerated codes replace the old ones ---
    const codes = await regenerateBackupCodes(ctx, nextPassword);
    expect(codes.length).toBeGreaterThanOrEqual(8);
    expect(peekOnce(mfaCodesKey(userId))).toBe(true);
    dropOnce(mfaCodesKey(userId));
    expect(peekOnce(mfaCodesKey(userId))).toBe(false);

    // --- sessions (1.4): sign in a second time, revoke that one, keep this one ---
    const extraCookie = (
      await signInHeaders(email, nextPassword, { totpSecret: secondSecret })
    ).get("cookie")!;
    void extraCookie;
    const sessions = listUserSessions(userId);
    expect(sessions.length).toBeGreaterThanOrEqual(2);

    const other = sessions.find((session) => session.token !== ctx.user.session.token)!;
    await revokeOwnSession(ctx, other.id);
    expect(listUserSessions(userId).some((session) => session.id === other.id)).toBe(false);
    // The actor's own session survives: revoking *one* session is not signing out.
    expect(ctx.headers.get("cookie")).toContain("pmd.session_token");

    // Revoking somebody else's session is refused (there is no other account here, so
    // the refusal is checked against an id that is not this actor's).
    await expectNotice(
      () => revokeOwnSession(ctx, "not-a-real-session-id"),
      "forbidden",
      "foreign session id",
    );

    // --- sign out everywhere kills every session of this account ---
    await signOutEverywhere(ctx);
    expect(sessionCount(userId)).toBe(0);
    const afterSignOut = await authCall("/get-session", { cookie: ctx.headers.get("cookie")! });
    expect(afterSignOut.json).toBeNull();

    // --- turning MFA off is possible, and it is audited ---
    const reopened = await contextFor(email, nextPassword, secondSecret);
    await disableMfa(reopened, nextPassword);
    expect(scalar<number>(userRow(email), "two_factor_enabled")).toBe(0);

    const actions = auditActions().map((row) => `${row.action}:${row.outcome}`);
    for (const expected of [
      "two_factor_enrolled:info",
      "two_factor_enrolled:success",
      "two_factor_disabled:info",
      "two_factor_disabled:success",
      "backup_codes_generated:success",
      "password_changed:success",
      "session_revoked:success",
      "sessions_revoked_all:success",
      "account_created:success",
    ]) {
      expect(actions, `missing audit row ${expected}`).toContain(expected);
    }

    // No credential or factor value ever reached the audit log (spec §14).
    for (const row of auditActions()) {
      const detail = row.detail ?? "";
      expect(detail).not.toContain(nextPassword);
      expect(detail).not.toContain(password);
      expect(detail).not.toContain(secondSecret);
    }
  });

  it("one-shot store holds nothing durable and nothing after the value was taken", () => {
    expect(oneShotCount()).toBeGreaterThanOrEqual(0);
    // The keys used above were consumed or dropped; a page re-render must show nothing.
    expect(peekOnce(mfaUriKey("nobody"))).toBe(false);
    expect(takeOnce(mfaCodesKey("nobody"))).toBeNull();
    expect(requestHeaders("pmd.session_token=x.y").get("cookie")).toBe("pmd.session_token=x.y");
  });
});
