import { headers } from "next/headers";

import { Shell } from "@/components/Shell";
import { getI18n } from "@/i18n/requestLocale";
import { can } from "@/lib/rbac";
import { NAV_DESTINATIONS, type NavKey } from "@/lib/roadmap";
import { requirePageUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * The shell chrome is rendered for every signed-in state, including the two states
 * that must be fixed (no MFA for a privileged role, blocked account). `authorize()`
 * already refuses every permission in those states, so the shell can show the
 * account honestly without leaking anything.
 *
 * Content pages re-check with their own rules — the security settings page is the
 * one page that may render while security is incomplete, otherwise fixing it would
 * redirect forever.
 */
export default async function ShellLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const { user, state } = await requirePageUser({ allowIncompleteSecurity: true });
  const { dict, locale } = await getI18n();
  const requestHeaders = await headers();
  const pathname = requestHeaders.get("x-pathname") ?? "/";

  const allowed: Partial<Record<NavKey, boolean>> = {};
  for (const dest of NAV_DESTINATIONS) {
    if (dest.permission) allowed[dest.key] = await can(user.actor, dest.permission);
  }

  return (
    <Shell
      user={user}
      securityState={state}
      pathname={pathname}
      allowed={allowed}
      dict={dict}
      locale={locale}
    >
      {children}
    </Shell>
  );
}
