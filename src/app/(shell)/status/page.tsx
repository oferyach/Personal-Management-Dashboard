import Link from "next/link";

import { LanguageToggle } from "@/i18n/LanguageToggle";
import { getI18n } from "@/i18n/requestLocale";
import { dirOf } from "@/i18n/locales";
import { getConfig, getEnvWarnings } from "@/lib/env";
import { getHealthSnapshot } from "@/lib/health";
import { requirePageUser } from "@/lib/requestAuth";
import { isProduction } from "@/lib/runtime";

export const dynamic = "force-dynamic";

/**
 * A measured machine value (pragma name, enum code, path, ISO timestamp,
 * version) is never translated and never reflowed: inside Hebrew text it is
 * rendered as an LTR island so `./data/app.db` and `127.0.0.1:4000` stay
 * readable and copy-pasteable.
 */
function Value({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <dd className="text-foreground ltr-island font-mono" dir="ltr" title={title}>
      {children}
    </dd>
  );
}

/** Localized label + raw machine value for tools, tests and operators. */
function Badge({
  tone,
  value,
  children,
}: {
  tone: "ok" | "warn" | "muted";
  value: string;
  children: React.ReactNode;
}) {
  const tones = {
    ok: "bg-success/15 text-success",
    warn: "bg-warning/15 text-warning",
    muted: "bg-muted text-muted-foreground",
  } as const;
  return (
    <span
      className={`rounded-full px-2.5 py-1 text-xs font-medium ${tones[tone]}`}
      data-value={value}
    >
      {children}
    </span>
  );
}

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
            {isRaw(row.value) ? <Value>{row.value}</Value> : row.value}
          </div>
        ))}
      </dl>
    </section>
  );
}

/**
 * System status (moved behind the login when the Phase 1 shell arrived, so raw
 * infrastructure facts are not public). Only measured runtime state is shown.
 * Status data is measured per request; a build-time snapshot would be a lie.
 *
 * Text layer: Hebrew (primary). Only presentation strings come from the
 * dictionary; every value is raw data from the process or the database.
 */
export default async function StatusPage() {
  await requirePageUser();
  const env = getConfig();
  const health = getHealthSnapshot();
  const warnings = isProduction() ? [] : getEnvWarnings();
  const { locale, dict } = await getI18n();
  const t = dict.status;
  const s = dict.states;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{dict.pages.status.title}</h1>
          <p className="text-muted-foreground mt-1 text-sm">{dict.pages.status.subtitle}</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge tone={health.status === "ok" ? "ok" : "warn"} value={health.status}>
            {s.health[health.status]}
          </Badge>
          <LanguageToggle locale={locale} dict={dict} nextPath="/status" />
        </div>
      </header>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <Card
          title={t.cards.database}
          rows={[
            {
              label: t.labels.status,
              value: health.database.ok ? (
                <Badge tone="ok" value="connected">
                  {s.database.connected}
                </Badge>
              ) : (
                <Badge tone="warn" value="unavailable">
                  {s.database.unavailable}
                </Badge>
              ),
            },
            { label: t.labels.file, value: health.database.file },
            { label: t.labels.journalMode, value: health.database.journalMode },
            { label: t.labels.foreignKeys, value: String(health.database.foreignKeys) },
            {
              label: t.labels.busyTimeout,
              value: `${health.database.busyTimeoutMs} ${dict.units.milliseconds}`,
            },
            { label: t.labels.synchronous, value: health.database.synchronous },
            { label: t.labels.migrationsApplied, value: health.database.migrationsApplied },
            { label: t.labels.tables, value: health.database.tableCount },
            { label: t.labels.schemaVersion, value: health.database.schemaVersion },
            { label: t.labels.sqlite, value: health.database.sqliteVersion },
          ]}
        />
        <Card
          title={t.cards.runtime}
          rows={[
            { label: t.labels.environment, value: env.nodeEnv },
            { label: t.labels.node, value: health.app.node },
            { label: t.labels.version, value: health.app.version },
            { label: t.labels.publicUrl, value: env.appUrl },
            { label: t.labels.uptime, value: `${health.uptimeSeconds} ${dict.units.seconds}` },
            { label: t.labels.timezone, value: env.defaultTimezone },
            { label: t.labels.language, value: `${locale} (${dirOf(locale)})` },
          ]}
        />
        <Card
          title={t.cards.worker}
          rows={[
            {
              label: t.labels.state,
              value: (
                <Badge
                  tone={health.worker.state === "online" ? "ok" : "muted"}
                  value={health.worker.state}
                >
                  {s.worker[health.worker.state]}
                </Badge>
              ),
            },
            { label: t.labels.detail, value: s.workerDetail[health.worker.state] },
            {
              label: t.labels.diagnostics,
              value: (
                <span className="font-mono text-xs" dir="ltr">
                  {health.worker.message}
                </span>
              ),
            },
            {
              label: t.labels.heartbeatAge,
              value:
                health.worker.heartbeatAgeSeconds === null
                  ? "—"
                  : health.worker.heartbeatAgeSeconds,
            },
          ]}
        />
        <Card
          title={t.cards.integrations}
          rows={[
            {
              label: t.labels.smtp,
              value: env.smtp ? (
                <Badge tone="ok" value="configured">
                  <span>{s.integration.configured}</span>{" "}
                  <span dir="ltr" className="ltr-island">
                    {env.smtp.host}:{env.smtp.port}
                  </span>
                </Badge>
              ) : (
                <Badge tone="muted" value="not_configured">
                  {s.integration.not_configured}
                </Badge>
              ),
            },
            {
              label: t.labels.onedrive,
              value: env.onedrive ? (
                <Badge tone="ok" value="configured">
                  {s.integration.configured}
                </Badge>
              ) : (
                <Badge tone="muted" value="not_configured">
                  {s.integration.not_configured}
                </Badge>
              ),
            },
          ]}
        />
      </div>

      {warnings.length > 0 ? (
        <section className="border-warning/40 bg-warning/10 mt-6 rounded-(--radius-card) border p-4 text-sm">
          <h2 className="text-warning font-semibold">{t.warningsHeading}</h2>
          <ul className="text-muted-foreground mt-2 list-disc space-y-1 ps-5">
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </section>
      ) : null}

      <footer className="text-muted-foreground mt-10 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <a className="text-accent underline underline-offset-4" href="/api/v1/health">
          {t.footer.healthLink}
        </a>
        <Link className="text-accent underline underline-offset-4" href="/">
          {dict.pages.dashboard.title}
        </Link>
        <span>
          {t.footer.nextPhase}{" "}
          <code className="font-mono" dir="ltr">
            docs/PLAN.md
          </code>
          .
        </span>
      </footer>
    </>
  );
}
