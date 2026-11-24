import Link from "next/link";

import { getI18n } from "@/i18n/requestLocale";
import { requirePageUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * The "signed in, not allowed" screen (spec §12: authentication and authorization
 * are different failures and must look different). A missing session goes to
 * `/login`; a session whose role lacks the permission lands here, with the machine
 * reason visible so the account holder and an administrator can tell what was asked.
 */
export default async function ForbiddenPage({
  searchParams,
}: {
  searchParams: Promise<{ permission?: string }>;
}) {
  // The page itself is open to any signed-in account: being refused elsewhere is not
  // a reason to refuse this screen too.
  await requirePageUser({ allowIncompleteSecurity: true });
  const { dict } = await getI18n();
  const params = await searchParams;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{dict.errors.forbiddenTitle}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{dict.errors.forbiddenBody}</p>
      </header>

      <section className="border-border bg-card mt-5 rounded-(--radius-card) border p-5 text-sm">
        <p>
          {dict.status.labels.state}:{" "}
          <span className="text-foreground ltr-island font-mono" dir="ltr">
            forbidden
          </span>
        </p>
        {params.permission ? (
          <p className="mt-2">
            {dict.activityPage.columns.action}:{" "}
            <span className="text-foreground ltr-island font-mono" dir="ltr">
              {params.permission}
            </span>
          </p>
        ) : null}
        <p className="mt-4">
          <Link className="text-accent underline underline-offset-4" href="/">
            {dict.errors.backToDashboard}
          </Link>
        </p>
      </section>
    </>
  );
}
