import { getI18n } from "@/i18n/requestLocale";
import { collectDashboardFacts } from "@/lib/dashboard";
import { getHealthSnapshot } from "@/lib/health";
import { can } from "@/lib/rbac";
import { requirePageUser } from "@/lib/requestAuth";
import { listUserSessions } from "@/lib/sessions";

export const dynamic = "force-dynamic";

function Card({
  title,
  rows,
}: {
  title: string;
  rows: Array<{ label: string; value: React.ReactNode }>;
}) {
  const isRaw = (value: React.ReactNode): value is string | number =>
    typeof value === "string" || typeof value === "number";

  return (
    <section
      className="border-border bg-card rounded-(--radius-card) border p-5"
      aria-label={title}
    >
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
        {title}
      </h2>
      <dl className="mt-4 space-y-2 text-sm">
        {rows.map((row) => (
          <div
            key={row.label}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
          >
            <dt className="text-muted-foreground">{row.label}</dt>
            {isRaw(row.value) ? (
              <dd className="text-foreground ltr-island font-mono" dir="ltr">
                {row.value}
              </dd>
            ) : (
              row.value
            )}
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * Work item 1.8 / 1.11 — the authenticated landing page (spec §7: the first page
 * requires login). Only two kinds of content appear here: facts measured from the
 * live process and database, and links the current role is actually allowed to use.
 */
export default async function DashboardPage() {
  const { user } = await requirePageUser();
  const { dict } = await getI18n();
  const t = dict.pages.dashboard;
  const facts = collectDashboardFacts(user.id);
  const health = getHealthSnapshot();
  const sessions = listUserSessions(user.id);

  const maySeeActivity = await can(user.actor, "audit.view");
  const maySeeUsers = await can(user.actor, "users.view");

  const roleLabels = dict.roles as Record<string, string>;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </header>

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <Card
          title={t.accountCard}
          rows={[
            { label: dict.shell.signedInAs, value: user.name ?? user.email },
            {
              label: dict.shell.role,
              value: <span data-value={user.role}>{roleLabels[user.role] ?? user.role}</span>,
            },
            {
              label: dict.shell.mfaOff,
              value: (
                <span data-value={String(user.twoFactorEnabled)}>
                  {user.twoFactorEnabled ? dict.shell.mfaOn : dict.shell.mfaOff}
                </span>
              ),
            },
            { label: t.sessionsCount, value: sessions.length },
            { label: t.lastSignIn, value: facts.lastSignInAt ?? dict.common.none },
          ]}
        />

        <Card
          title={t.securityCard}
          rows={[
            { label: t.signInCountToday, value: facts.signInAttemptsToday },
            { label: t.activityCard, value: facts.auditRowsToday },
            {
              label: dict.pages.status.title,
              value: <span data-value={health.status}>{dict.states.health[health.status]}</span>,
            },
            { label: t.accountsTotal, value: facts.accountsTotal },
          ]}
        />
      </div>

      <section
        className="border-border bg-card mt-4 rounded-(--radius-card) border p-5"
        aria-label={t.accountsByRole}
      >
        <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
          {t.accountsByRole}
        </h2>
        <ul className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm">
          {facts.accountsByRole.map((row) => (
            <li key={row.role}>
              <span className="text-muted-foreground">{roleLabels[row.role] ?? row.role}</span>{" "}
              <span className="text-foreground ltr-island font-mono" dir="ltr">
                {row.count}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <nav aria-label={t.title} className="mt-6 flex flex-wrap gap-3 text-sm">
        <a
          className="border-border bg-card rounded-(--radius-card) border px-3 py-2"
          href="/status"
        >
          {t.openStatus}
        </a>
        <a
          className="border-border bg-card rounded-(--radius-card) border px-3 py-2"
          href="/settings"
        >
          {t.openSettings}
        </a>
        {maySeeActivity ? (
          <a
            className="border-border bg-card rounded-(--radius-card) border px-3 py-2"
            href="/activity"
          >
            {t.openActivity}
          </a>
        ) : null}
        {maySeeUsers ? (
          <a
            className="border-border bg-card rounded-(--radius-card) border px-3 py-2"
            href="/users"
          >
            {t.openUsers}
          </a>
        ) : null}
      </nav>
    </>
  );
}
