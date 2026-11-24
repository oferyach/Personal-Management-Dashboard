import {
  Feedback,
  MachineValue,
  SectionCard,
  SubmitButton,
  TabLinks,
  TextField,
} from "@/components/forms";
import { getI18n } from "@/i18n/requestLocale";
import { mfaCodesKey, mfaUriKey, pendingMfaEnrollment } from "@/lib/accountSecurity";
import { peekOnce, takeOnce } from "@/lib/oneShot";
import { requirePageUser } from "@/lib/requestAuth";
import { listUserSessions } from "@/lib/sessions";
import {
  cancelMfaAction,
  changePasswordAction,
  confirmMfaAction,
  disableMfaAction,
  regenerateCodesAction,
  revokeOwnSessionAction,
  signOutEverywhereAction,
  startMfaAction,
} from "../actions";

export const dynamic = "force-dynamic";

/**
 * Work items 1.5–1.7, 1.10 — the account security screen.
 *
 * This is the one page that renders in every signed-in state, including
 * `mfa_required` and `must_change_password`, because it is the way out of those
 * states; redirecting a broken account away from the screen that fixes it would loop
 * forever (see `requirePageUser`).
 *
 * The TOTP URI, the shared secret and the backup codes are read with `takeOnce()`:
 * the first render after they are produced shows them and destroys them. Reloading
 * this page cannot show them again, which is the point — Better Auth keeps the only
 * durable copies (the encrypted TOTP secret and the hashed codes).
 */
export default async function SecurityPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; done?: string; reason?: string }>;
}) {
  const { user, state } = await requirePageUser({ allowIncompleteSecurity: true });
  const { dict } = await getI18n();
  const t = dict.settings.security;
  const params = await searchParams;

  const uriAndSecret = takeOnce(mfaUriKey(user.id));
  const backupCodes = takeOnce(mfaCodesKey(user.id));
  const pending = pendingMfaEnrollment(user.id);
  const sessions = listUserSessions(user.id);
  const codesStillQueued = peekOnce(mfaCodesKey(user.id));

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </header>

      <div className="mt-4">
        <TabLinks
          label={dict.settings.title}
          pathname="/settings/security"
          tabs={[
            { href: "/settings", label: dict.settings.title },
            { href: "/settings/profile", label: dict.settings.tabs.profile },
            { href: "/settings/security", label: dict.settings.tabs.security },
          ]}
        />
      </div>

      <div className="mt-5 space-y-4">
        <Feedback dict={dict} notice={params.notice} done={params.done} />

        {state === "mfa_required" || params.reason === "mfa" ? (
          <p className="border-warning bg-warning/10 rounded-(--radius-card) border px-4 py-3 text-sm">
            {t.mfaSection}: {dict.shell.mfaRequiredBody}
            <MachineValue value="mfa_required" />
          </p>
        ) : null}

        {state === "banned" ? (
          <p className="border-danger bg-danger/10 rounded-(--radius-card) border px-4 py-3 text-sm">
            {dict.shell.bannedTitle}
            {user.banReason ? ` — ${user.banReason}` : ""}
            <MachineValue value="banned" />
          </p>
        ) : null}

        {user.mustChangePassword || params.reason === "password" ? (
          <p className="border-warning bg-warning/10 rounded-(--radius-card) border px-4 py-3 text-sm">
            {dict.shell.mustChangePasswordTitle} — {dict.shell.mustChangePasswordBody}
          </p>
        ) : null}

        {/* -------------------------------------------------------- two-factor */}
        <SectionCard title={t.mfaSection} body={pending ? t.pendingBody : t.enrollBody}>
          <p className="text-sm">
            {user.twoFactorEnabled ? t.mfaStateOn : t.mfaStateOff}{" "}
            <MachineValue value={`twoFactorEnabled=${user.twoFactorEnabled}`} />
            {pending ? <MachineValue value="pending_enrollment" /> : null}
          </p>

          {uriAndSecret ? (
            <dl className="mt-4 space-y-2 text-sm">
              <div>
                <dt className="text-muted-foreground">{t.totpUriLabel}</dt>
                <dd
                  className="text-foreground ltr-island bg-muted mt-1 rounded-(--radius-card) px-3 py-2 font-mono text-xs break-all"
                  dir="ltr"
                >
                  {uriAndSecret[0]}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t.secretLabel}</dt>
                <dd
                  className="text-foreground ltr-island bg-muted mt-1 rounded-(--radius-card) px-3 py-2 font-mono text-xs"
                  dir="ltr"
                >
                  {uriAndSecret[1]}
                </dd>
              </div>
            </dl>
          ) : null}

          {backupCodes ? (
            <div className="mt-4">
              <p className="text-sm font-semibold">{t.backupTitle}</p>
              <p className="text-muted-foreground text-xs">{t.backupShownOnce}</p>
              <ul className="mt-2 grid gap-2 sm:grid-cols-2">
                {backupCodes.map((code) => (
                  <li
                    key={code}
                    className="text-foreground ltr-island bg-muted rounded-(--radius-card) px-3 py-2 font-mono text-sm"
                    dir="ltr"
                  >
                    {code}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground mt-2 text-xs">{t.backupBody}</p>
            </div>
          ) : null}

          {pending ? (
            <div className="mt-4 space-y-4">
              <form action={confirmMfaAction} className="flex flex-wrap items-end gap-3">
                <TextField name="code" label={dict.auth.twoFactor.codeLabel} machine required />
                <SubmitButton label={t.confirmButton} />
              </form>
              <form action={cancelMfaAction} className="flex flex-wrap items-end gap-3">
                <TextField
                  name="password"
                  label={t.currentPassword}
                  type="password"
                  autoComplete="current-password"
                  required
                />
                <SubmitButton label={t.pendingCancel} variant="secondary" />
              </form>
            </div>
          ) : null}

          {!user.twoFactorEnabled && !pending ? (
            <form action={startMfaAction} className="mt-4 flex flex-wrap items-end gap-3">
              <TextField
                name="password"
                label={t.currentPassword}
                type="password"
                autoComplete="current-password"
                hint={t.requiresPassword}
                required
              />
              <SubmitButton label={t.enableButton} />
            </form>
          ) : null}

          {user.twoFactorEnabled ? (
            <div className="mt-4 space-y-4">
              <form action={regenerateCodesAction} className="flex flex-wrap items-end gap-3">
                <TextField
                  name="password"
                  label={t.currentPassword}
                  type="password"
                  autoComplete="current-password"
                  required
                />
                <SubmitButton label={t.regenerateButton} variant="secondary" />
              </form>
              <form action={disableMfaAction} className="flex flex-wrap items-end gap-3">
                <TextField
                  name="password"
                  label={t.currentPassword}
                  type="password"
                  autoComplete="current-password"
                  hint={t.disableBody}
                  required
                />
                <SubmitButton label={t.disableButton} variant="danger" />
              </form>
              {codesStillQueued ? (
                <p className="text-muted-foreground text-xs">{t.backupShownOnce}</p>
              ) : null}
            </div>
          ) : null}
        </SectionCard>

        {/* ---------------------------------------------------------- password */}
        <SectionCard title={t.passwordChangeTitle} body={t.passwordPolicy}>
          <form action={changePasswordAction} className="grid gap-4 sm:grid-cols-3">
            <TextField
              name="currentPassword"
              label={t.currentPassword}
              type="password"
              autoComplete="current-password"
              required
            />
            <TextField
              name="newPassword"
              label={t.newPassword}
              type="password"
              autoComplete="new-password"
              required
            />
            <TextField
              name="confirmPassword"
              label={t.confirmPassword}
              type="password"
              autoComplete="new-password"
              required
            />
            <div className="sm:col-span-3">
              <SubmitButton label={t.changePassword} />
            </div>
          </form>
        </SectionCard>

        {/* ---------------------------------------------------------- sessions */}
        <SectionCard title={t.sessionsSection} body={t.sessionsBody}>
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left">
              <tr>
                <th className="text-start">{t.sessionsColumns.created}</th>
                <th className="text-start">{t.sessionsColumns.expires}</th>
                <th className="text-start">{t.sessionsColumns.ip}</th>
                <th className="text-start">{t.revokeSession}</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-border border-t align-top">
                  <td className="py-2">
                    <span className="ltr-island font-mono text-xs" dir="ltr">
                      {session.createdAt}
                    </span>
                    {session.id === user.session.id ? (
                      <span className="ms-2 text-xs">{t.sessionsColumns.current}</span>
                    ) : null}
                  </td>
                  <td className="py-2">
                    <span className="ltr-island font-mono text-xs" dir="ltr">
                      {session.expiresAt}
                    </span>
                  </td>
                  <td className="py-2">
                    <span className="ltr-island font-mono text-xs" dir="ltr">
                      {session.ipAddress ?? dict.common.none}
                    </span>
                  </td>
                  <td className="py-2">
                    <form action={revokeOwnSessionAction}>
                      <input type="hidden" name="sessionId" value={session.id} />
                      <SubmitButton label={t.revokeSession} variant="secondary" />
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <form action={signOutEverywhereAction} className="mt-4">
            <SubmitButton label={t.revokeAll} variant="danger" />
          </form>
        </SectionCard>
      </div>
    </>
  );
}
