import Link from "next/link";

import { MachineValue, TabLinks } from "@/components/forms";
import { getI18n } from "@/i18n/requestLocale";
import { can } from "@/lib/rbac";
import { requirePageUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * Work item 1.9 — the settings hub. Both tabs are reachable by every signed-in
 * account because the two things they hold (own profile, own security) belong to the
 * account itself; what differs per role is shown honestly rather than hidden.
 */
export default async function SettingsPage() {
  const { user, state } = await requirePageUser({ allowIncompleteSecurity: true });
  const { dict, locale } = await getI18n();
  const t = dict.settings;

  const mayEditProfile = await can(user.actor, "settings.edit_own");

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </header>

      <div className="mt-4">
        <TabLinks
          label={t.title}
          pathname="/settings"
          tabs={[
            { href: "/settings", label: t.title },
            { href: "/settings/profile", label: t.tabs.profile },
            { href: "/settings/security", label: t.tabs.security },
          ]}
        />
      </div>

      <section className="border-border bg-card mt-5 rounded-(--radius-card) border p-5 text-sm">
        <h2 className="text-lg font-semibold">{dict.shell.account}</h2>
        <dl className="mt-3 space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-muted-foreground">{dict.shell.signedInAs}</dt>
            <dd>{user.email}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-muted-foreground">{dict.shell.role}</dt>
            <dd>
              {dict.roles[user.role]} <MachineValue value={user.role} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-muted-foreground">{dict.shell.mfaOff}</dt>
            <dd>
              {user.twoFactorEnabled ? dict.shell.mfaOn : dict.shell.mfaOff}{" "}
              <MachineValue value={String(user.twoFactorEnabled)} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-muted-foreground">{dict.usersPage.columns.mustChangePassword}</dt>
            <dd>
              {user.mustChangePassword ? dict.common.yes : dict.common.no}{" "}
              <MachineValue value={String(user.mustChangePassword)} />
            </dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-muted-foreground">{dict.nav.settings}</dt>
            <dd>{mayEditProfile ? dict.common.yes : dict.settings.profile.readOnlyHint}</dd>
          </div>
          <div className="flex flex-wrap items-baseline justify-between gap-x-4">
            <dt className="text-muted-foreground">{dict.ui.language.label}</dt>
            <dd>{dict.ui.language[locale]}</dd>
          </div>
        </dl>

        {state === "mfa_required" ? (
          <p className="border-warning bg-warning/10 mt-4 rounded-(--radius-card) border px-4 py-3">
            {dict.shell.mfaRequiredTitle} — {dict.shell.mfaRequiredBody}
          </p>
        ) : null}
        {state === "banned" ? (
          <p className="border-danger bg-danger/10 mt-4 rounded-(--radius-card) border px-4 py-3">
            {dict.shell.bannedTitle} — {dict.shell.bannedBody}
          </p>
        ) : null}
        {user.mustChangePassword ? (
          <p className="border-warning bg-warning/10 mt-4 rounded-(--radius-card) border px-4 py-3">
            {dict.shell.mustChangePasswordTitle} — {dict.shell.mustChangePasswordBody}{" "}
            <Link className="text-accent underline underline-offset-4" href="/settings/security">
              {dict.shell.fixIt}
            </Link>
          </p>
        ) : null}

        <p className="text-muted-foreground mt-4 text-sm">{dict.settings.profile.saveHint}</p>
      </section>
    </>
  );
}
