import { MachineValue } from "@/components/forms";
import { getI18n } from "@/i18n/requestLocale";
import { AUDIT_ACTIONS, readAudit, type AuditAction, type AuditOutcome } from "@/lib/audit";
import { listDirectory } from "@/lib/rbac";
import { requirePagePermission } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

const LIMITS = [25, 100, 250] as const;

function isAuditAction(value: string | undefined): value is AuditAction {
  return !!value && (AUDIT_ACTIONS as readonly string[]).includes(value);
}

const OUTCOME_TONE: Record<AuditOutcome, string> = {
  success: "text-success",
  failure: "text-danger",
  denied: "text-warning",
  info: "text-muted-foreground",
};

/**
 * Work item 1.11 — the audit trail made readable. Only rows that were actually
 * written by the auth and administration paths appear here; the filter is a plain GET
 * form so the screen works without JavaScript, and every column is shown as stored
 * (ISO timestamps, action keys, outcome keys, IP addresses) beside its localized label.
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ action?: string; limit?: string }>;
}) {
  const { user } = await requirePagePermission("audit.view");
  const { dict } = await getI18n();
  const t = dict.activityPage;
  const params = await searchParams;

  const action = isAuditAction(params.action) ? params.action : undefined;
  const limit = LIMITS.includes(Number(params.limit) as (typeof LIMITS)[number])
    ? Number(params.limit)
    : 100;

  const rows = readAudit({ action, limit });
  const names = new Map((await listDirectory()).map((row) => [row.id, row.name || row.email]));
  const labelForActor = (id: string | null) => (id ? (names.get(id) ?? null) : null);

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </header>

      <form method="get" className="mt-4 flex flex-wrap items-end gap-3 text-sm">
        <label className="text-muted-foreground" htmlFor="action">
          {t.filterLabel}
          <select
            id="action"
            name="action"
            defaultValue={action ?? ""}
            className="border-border bg-background mt-1 block rounded-(--radius-card) border px-3 py-2"
          >
            <option value="">{t.filterAll}</option>
            {AUDIT_ACTIONS.map((key) => (
              <option key={key} value={key}>
                {dict.auditActions[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="text-muted-foreground" htmlFor="limit">
          {t.limitLabel}
          <select
            id="limit"
            name="limit"
            defaultValue={String(limit)}
            className="border-border bg-background mt-1 block rounded-(--radius-card) border px-3 py-2"
          >
            {LIMITS.map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <button
          type="submit"
          className="border-border bg-card text-foreground rounded-(--radius-card) border px-4 py-2"
        >
          {dict.common.refresh}
        </button>
      </form>

      <section className="border-border bg-card mt-5 rounded-(--radius-card) border p-5">
        {rows.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-175 text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="text-start">{t.columns.time}</th>
                  <th className="text-start">{t.columns.action}</th>
                  <th className="text-start">{t.columns.actor}</th>
                  <th className="text-start">{t.columns.target}</th>
                  <th className="text-start">{t.columns.outcome}</th>
                  <th className="text-start">{t.columns.ip}</th>
                  <th className="text-start">{t.columns.detail}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-border border-t align-top">
                    <td className="py-2">
                      <span className="ltr-island font-mono text-xs" dir="ltr">
                        {row.createdAt}
                      </span>
                    </td>
                    <td className="py-2">
                      {dict.auditActions[row.action]} <MachineValue value={row.action} />
                    </td>
                    <td className="py-2">
                      {labelForActor(row.actorUserId) ?? dict.common.unknown}{" "}
                      {row.actorUserId ? <MachineValue value={row.actorUserId} /> : null}
                    </td>
                    <td className="py-2">
                      {row.targetKind ? (
                        <>
                          {row.targetKind}{" "}
                          {row.targetUserId ? (
                            <MachineValue value={row.targetUserId} />
                          ) : row.targetId ? (
                            <MachineValue value={row.targetId} />
                          ) : null}
                        </>
                      ) : (
                        dict.common.none
                      )}
                    </td>
                    <td className={`py-2 ${OUTCOME_TONE[row.outcome]}`}>
                      {t.outcomes[row.outcome]} <MachineValue value={row.outcome} />
                    </td>
                    <td className="py-2">
                      <span className="ltr-island font-mono text-xs" dir="ltr">
                        {row.ipAddress ?? dict.common.none}
                      </span>
                    </td>
                    <td className="py-2">
                      <span className="ltr-island font-mono text-xs break-all" dir="ltr">
                        {row.detail ?? dict.common.none}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-muted-foreground mt-4 text-xs">
          {t.note} {dict.shell.signedInAs}: {user.email}
        </p>
      </section>
    </>
  );
}
