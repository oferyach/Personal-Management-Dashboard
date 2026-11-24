import { TwoFactorForm } from "@/components/TwoFactorForm";
import { getI18n } from "@/i18n/requestLocale";

export const dynamic = "force-dynamic";

/**
 * Work item 1.6 — the second-factor step. Deliberately open without a session:
 * measured behaviour of Better Auth 1.7.27 is that a password sign-in for an MFA
 * user issues **no** session; the pending step is carried by a signed 10-minute
 * challenge cookie, and the session is created only after the code verifies.
 */
export default async function TwoFactorVerifyPage() {
  const { dict } = await getI18n();
  const t = dict.auth.twoFactor;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.subtitle}</p>
      </header>
      <div className="mt-5">
        <TwoFactorForm copy={t} />
      </div>
      <p className="text-muted-foreground mt-5 text-sm">
        <a className="text-accent underline underline-offset-4" href="/login">
          {dict.common.back}
        </a>
      </p>
    </>
  );
}
