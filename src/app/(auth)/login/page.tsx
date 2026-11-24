import { redirect } from "next/navigation";

import { LoginForm } from "@/components/LoginForm";
import { getI18n } from "@/i18n/requestLocale";
import { sessionState } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * Work item 1.1 — the first page an unauthenticated visitor sees (spec §7).
 * The form posts to Better Auth's own endpoint through its client; this page never
 * touches a password itself.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  const state = await sessionState();
  if (state.kind !== "anonymous") redirect("/");

  const { dict } = await getI18n();
  const { reason } = await searchParams;
  const reasons: Record<string, string> = dict.auth.login.reasons;
  const notice = reason && reasons[reason] ? reasons[reason] : null;
  const t = dict.auth.login;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </header>

      {notice ? (
        <p
          className="border-border bg-muted mt-4 rounded-(--radius-card) border px-3 py-2 text-sm"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div className="mt-5">
        <LoginForm copy={t} />
      </div>

      <p className="text-muted-foreground mt-5 text-sm">{t.noAccount}</p>
    </>
  );
}
