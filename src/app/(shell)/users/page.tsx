import {
  Feedback,
  MachineValue,
  SectionCard,
  SelectField,
  SubmitButton,
  TextField,
} from "@/components/forms";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { getI18n } from "@/i18n/requestLocale";
import { tempPasswordKey } from "@/lib/accountSecurity";
import { takeOnce } from "@/lib/oneShot";
import { can, isPrivilegedRole, readRoleMatrix, ROLE_KEYS } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/requestAuth";
import { listManagedDirectory } from "@/lib/userAdministration";
import {
  changeRoleAction,
  createUserAction,
  resetUserPasswordAction,
  revokeUserSessionsAction,
  setAccountActiveAction,
} from "./actions";

export const dynamic = "force-dynamic";

/**
 * Work items 1.2–1.4 — accounts, roles and account security actions.
 *
 * Every control here posts to a Server Action that re-checks its own permission, so
 * hiding a control is presentation, not protection. What is role-dependent is shown
 * as disabled with a reason rather than removed, and each row carries the raw role
 * key, MFA flag and session count as machine values.
 */
export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; done?: string; shown?: string }>;
}) {
  const { user } = await requirePagePermission("users.view");
  const { dict } = await getI18n();
  const t = dict.usersPage;
  const params = await searchParams;

  const mayCreate = await can(user.actor, "users.create");
  const mayAssignRole = await can(user.actor, "roles.assign");
  const mayDeactivate = await can(user.actor, "users.deactivate");
  const mayResetPassword = await can(user.actor, "users.reset_password");
  const mayRevokeSessions = await can(user.actor, "users.revoke_sessions");

  const directory = listManagedDirectory();
  const roleMatrix = await readRoleMatrix();
  const shownPassword = params.shown ? takeOnce(tempPasswordKey(params.shown)) : null;
  const shownAccount = params.shown
    ? directory.users.find((row) => row.id === params.shown)
    : undefined;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
        <p className="mt-1 text-sm">
          {t.count}: <MachineValue value={directory.total} />
        </p>
      </header>

      <div className="mt-5 space-y-4">
        <Feedback dict={dict} notice={params.notice} done={params.done} />

        {shownAccount ? (
          <SectionCard title={`${t.created} — ${shownAccount.email}`}>
            <p className="text-sm">{t.temporaryPassword}</p>
            {shownPassword ? (
              <p
                className="text-foreground ltr-island bg-muted mt-2 rounded-(--radius-card) px-3 py-2 font-mono text-sm"
                dir="ltr"
              >
                {shownPassword[0]}
              </p>
            ) : (
              <p className="text-muted-foreground mt-2 text-sm">{t.tempPasswordGone}</p>
            )}
            <p className="text-muted-foreground mt-2 text-xs">{t.tempPasswordShownOnce}</p>
          </SectionCard>
        ) : null}

        {mayCreate ? (
          <SectionCard title={t.createTitle} body={t.createBody}>
            <form action={createUserAction} className="grid gap-4 sm:grid-cols-3">
              <TextField name="name" label={t.name} autoComplete="off" required />
              <TextField name="email" label={t.email} type="email" machine required />
              <SelectField
                name="role"
                label={t.role}
                value="user"
                options={ROLE_KEYS.map((role) => ({ value: role, label: dict.roles[role] }))}
                required
              />
              <div className="sm:col-span-3">
                <SubmitButton label={t.createButton} />
              </div>
            </form>
          </SectionCard>
        ) : null}

        <SectionCard title={t.title}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-175 text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="text-start">{t.columns.name}</th>
                  <th className="text-start">{t.columns.email}</th>
                  <th className="text-start">{t.columns.role}</th>
                  <th className="text-start">{t.columns.mfa}</th>
                  <th className="text-start">{t.columns.mustChangePassword}</th>
                  <th className="text-start">{t.columns.sessions}</th>
                  <th className="text-start">{t.columns.banned}</th>
                  <th className="text-start">{t.columns.actions}</th>
                </tr>
              </thead>
              <tbody>
                {directory.users.map((row) => {
                  const isSelf = row.id === user.id;
                  return (
                    <tr key={row.id} className="border-border border-t align-top">
                      <td className="py-2">{row.name}</td>
                      <td className="py-2">
                        <span className="ltr-island font-mono text-xs" dir="ltr">
                          {row.email}
                        </span>
                        {isSelf ? (
                          <span className="ms-2 text-xs">{dict.shell.signedInAs}</span>
                        ) : null}
                      </td>
                      <td className="py-2">
                        {mayAssignRole && !isSelf ? (
                          <form action={changeRoleAction} className="flex items-center gap-2">
                            <input type="hidden" name="userId" value={row.id} />
                            <select
                              name="role"
                              defaultValue={row.role}
                              className="border-border bg-background rounded-(--radius-card) border px-2 py-1 text-sm"
                            >
                              {ROLE_KEYS.map((role) => (
                                <option key={role} value={role}>
                                  {dict.roles[role]}
                                </option>
                              ))}
                            </select>
                            <ConfirmSubmitButton
                              label={t.actions.changeRole}
                              confirmLabel={dict.common.confirm}
                              cancelLabel={dict.common.cancel}
                              message={dict.common.accountAccessConfirmation}
                              variant="secondary"
                            />
                          </form>
                        ) : (
                          <>
                            {dict.roles[row.role]} <MachineValue value={row.role} />
                          </>
                        )}
                      </td>
                      <td className="py-2">
                        <MachineValue value={String(row.twoFactorEnabled)} />
                      </td>
                      <td className="py-2">
                        <MachineValue value={String(row.mustChangePassword)} />
                      </td>
                      <td className="py-2">
                        <MachineValue value={row.activeSessions} />
                      </td>
                      <td className="py-2">
                        {row.banned ? (
                          <span className="text-danger">
                            {dict.common.yes}
                            <MachineValue value="banned" />
                          </span>
                        ) : (
                          dict.common.no
                        )}
                      </td>
                      <td className="py-2">
                        <div className="flex flex-wrap gap-2">
                          {mayRevokeSessions && !isSelf ? (
                            <form action={revokeUserSessionsAction}>
                              <input type="hidden" name="userId" value={row.id} />
                              <ConfirmSubmitButton
                                label={t.actions.revokeSessions}
                                confirmLabel={dict.common.confirm}
                                cancelLabel={dict.common.cancel}
                                message={dict.common.accountAccessConfirmation}
                                variant="secondary"
                              />
                            </form>
                          ) : null}
                          {mayResetPassword && !isSelf ? (
                            <form action={resetUserPasswordAction}>
                              <input type="hidden" name="userId" value={row.id} />
                              <ConfirmSubmitButton
                                label={t.actions.resetPassword}
                                confirmLabel={dict.common.confirm}
                                cancelLabel={dict.common.cancel}
                                message={dict.common.accountAccessConfirmation}
                                variant="secondary"
                              />
                            </form>
                          ) : null}
                          {mayDeactivate && !isSelf ? (
                            <form action={setAccountActiveAction}>
                              <input type="hidden" name="userId" value={row.id} />
                              <input
                                type="hidden"
                                name="active"
                                value={row.banned ? "true" : "false"}
                              />
                              <ConfirmSubmitButton
                                label={row.banned ? t.actions.reactivate : t.actions.deactivate}
                                variant={row.banned ? "secondary" : "danger"}
                                confirmLabel={dict.common.confirm}
                                cancelLabel={dict.common.cancel}
                                message={dict.common.accountAccessConfirmation}
                              />
                            </form>
                          ) : null}
                          {isSelf && isPrivilegedRole(user.role) ? (
                            <span className="text-muted-foreground text-xs">
                              {t.feedback.denied}
                            </span>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title={t.permissionMatrix} body={t.permissionMatrixBody}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-150 text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="text-start">{t.role}</th>
                  <th className="text-start">{t.privileged}</th>
                  <th className="text-start">{t.permissions}</th>
                </tr>
              </thead>
              <tbody>
                {roleMatrix.map((entry) => (
                  <tr key={entry.role} className="border-border border-t align-top">
                    <td className="py-3">
                      {dict.roles[entry.role]} <MachineValue value={entry.role} />
                    </td>
                    <td className="py-3">{entry.privileged ? dict.common.yes : dict.common.no}</td>
                    <td className="py-3">
                      <ul className="flex max-w-3xl flex-wrap gap-1">
                        {entry.permissions.map((permission) => (
                          <li key={permission}>
                            <MachineValue value={permission} />
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>
    </>
  );
}
