import Link from "next/link";
import { getI18n } from "@/i18n/requestLocale";

/**
 * Localized 404 (Hebrew-first). A 404 is a real page a real user lands on from
 * an old bookmark, so it gets the same language/direction treatment as the rest
 * of the app. No stack traces, no internals (spec §14) — already asserted by
 * tests/e2e/phase0.spec.ts.
 */
export default async function NotFound() {
  const { dict } = await getI18n();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-16 sm:px-8">
      <p className="text-muted-foreground font-mono text-sm" dir="ltr">
        404
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{dict.notFound.title}</h1>
      <p className="text-muted-foreground mt-2 text-sm">{dict.notFound.body}</p>
      <Link className="text-accent mt-6 inline-block underline underline-offset-4" href="/">
        {dict.notFound.backHome}
      </Link>
    </main>
  );
}
