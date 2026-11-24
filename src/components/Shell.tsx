import Link from "next/link";

import type { Dictionary } from "@/i18n/dictionaries/types";
import type { Locale } from "@/i18n/locales";
import { LanguageToggle } from "@/i18n/LanguageToggle";
import { signOutAction } from "@/app/(shell)/actions";
import type { RoleKey } from "@/db/schema/identity";
import { isDestinationActive, NAV_DESTINATIONS, type NavKey } from "@/lib/roadmap";
import type { AuthenticatedUser } from "@/lib/sessions";

/**
 * The Phase 1 app shell (work item 1.8).
 *
 * No client JavaScript is needed to open the menu, collapse the sidebar or sign
 * out: the toggles are checkboxes and sign-out is a form POST to a server action.
 * That keeps the shell usable with scripts disabled, which later phases rely on too.
 */
export interface ShellProps {
  user: AuthenticatedUser;
  /** Rendered as a blocking banner; `authorize()` already refuses everything in these states. */
  securityState: "ok" | "mfa_required" | "banned";
  pathname: string;
  allowed: Partial<Record<NavKey, boolean>>;
  dict: Dictionary;
  locale: Locale;
  children: React.ReactNode;
}

function roleLabel(dict: Dictionary, role: RoleKey): string {
  const labels: Record<string, string> = dict.roles;
  return labels[role] ?? role;
}

export function Shell({
  user,
  securityState,
  pathname,
  allowed,
  dict,
  locale,
  children,
}: ShellProps) {
  const s = dict.shell;
  const items = NAV_DESTINATIONS.filter(
    (dest) => dest.permission === null || allowed[dest.key] !== false,
  );

  return (
    <>
      <a
        href="#main"
        className="skip-link bg-card border-border rounded-(--radius-card) border px-3 py-2 text-sm"
      >
        {s.skipToContent}
      </a>

      {/* JS-free toggles. They must precede .pmd-shell so the CSS sibling rules apply. */}
      <label className="pmd-nav-toggle border-border bg-card rounded-(--radius-card) border px-3 py-2 text-sm">
        <input type="checkbox" id="pmd-nav-toggle" className="me-2" />
        {s.openMenu}
      </label>
      <label className="pmd-collapse-toggle border-border bg-card rounded-(--radius-card) border px-2 py-1 text-xs">
        <input type="checkbox" id="pmd-collapse-toggle" className="me-2" />
        <span className="pmd-nav-label">{s.collapseMenu}</span>
      </label>

      <div className="pmd-shell">
        <aside className="border-border bg-card flex flex-col gap-4 border-e p-4">
          <div className="flex items-center justify-between gap-2">
            <Link href="/" className="text-foreground text-base font-semibold tracking-tight">
              {dict.app.name}
            </Link>
          </div>

          <nav aria-label={dict.nav.heading}>
            <h2 className="text-muted-foreground pmd-nav-heading text-xs font-semibold tracking-wide uppercase">
              {dict.nav.heading}
            </h2>
            <ul className="mt-2 flex flex-col gap-1">
              {items.map((dest) => {
                const active = isDestinationActive(dest, pathname);
                return (
                  <li key={dest.key}>
                    <Link
                      href={dest.path}
                      aria-current={active ? "page" : undefined}
                      className={`rounded-(--radius-card) px-3 py-2 text-sm ${
                        active
                          ? "bg-accent/15 text-accent font-semibold"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {dict.nav[dest.key]}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="border-border mt-auto border-t pt-3 text-sm">
            <p className="text-muted-foreground text-xs">{s.signedInAs}</p>
            <p className="text-foreground pmd-account-name font-medium">
              {user.name ?? user.email}
            </p>
            <p className="text-muted-foreground">
              {s.role}: <span data-value={user.role}>{roleLabel(dict, user.role)}</span>
            </p>
            <p className="mt-1">
              {user.twoFactorEnabled ? (
                <span className="text-success">{s.mfaOn}</span>
              ) : (
                <span className="text-warning">{s.mfaOff}</span>
              )}
            </p>
            <form action={signOutAction} className="mt-3">
              <button
                type="submit"
                className="border-border hover:bg-muted rounded-(--radius-card) border px-3 py-2 text-sm"
              >
                {dict.auth.signOut}
              </button>
            </form>
            <div className="mt-3">
              <LanguageToggle locale={locale} dict={dict} nextPath={pathname} />
            </div>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col">
          <header className="border-border bg-card flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
            <p className="text-muted-foreground text-sm">{dict.app.name}</p>
            <p className="text-muted-foreground text-sm" dir="ltr">
              {user.email}
            </p>
          </header>

          {securityState !== "ok" ? (
            <section
              className="border-warning/40 bg-warning/10 border-b px-5 py-4"
              role="alert"
              aria-live="polite"
            >
              <h2 className="text-warning text-sm font-semibold">
                {securityState === "mfa_required" ? s.mfaRequiredTitle : s.bannedTitle}
              </h2>
              <p className="text-muted-foreground mt-1 text-sm">
                {securityState === "mfa_required" ? s.mfaRequiredBody : s.bannedBody}
              </p>
              {securityState === "mfa_required" ? (
                <Link
                  className="text-accent mt-2 inline-block text-sm underline underline-offset-4"
                  href="/settings/security?reason=mfa"
                >
                  {s.fixIt}
                </Link>
              ) : null}
            </section>
          ) : user.mustChangePassword ? (
            <section className="border-warning/40 bg-warning/10 border-b px-5 py-4" role="alert">
              <h2 className="text-warning text-sm font-semibold">{s.mustChangePasswordTitle}</h2>
              <p className="text-muted-foreground mt-1 text-sm">{s.mustChangePasswordBody}</p>
              <Link
                className="text-accent mt-2 inline-block text-sm underline underline-offset-4"
                href="/settings/security"
              >
                {s.fixIt}
              </Link>
            </section>
          ) : null}

          <main id="main" className="w-full max-w-6xl px-5 py-8">
            {children}
          </main>
        </div>
      </div>
    </>
  );
}
