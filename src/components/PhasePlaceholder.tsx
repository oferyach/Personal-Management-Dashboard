import type { Dictionary } from "@/i18n/dictionaries/types";

import { NAV_DESTINATIONS, type NavKey } from "@/lib/roadmap";

/**
 * The honest placeholder (work item 1.8). The destination exists in the shell from
 * Phase 1, but the feature is not built yet — so the screen says which phase and
 * which gate will build it instead of showing an empty mock or invented content.
 */
export function PhasePlaceholder({ dest, dict }: { dest: NavKey; dict: Dictionary }) {
  const destination = NAV_DESTINATIONS.find((item) => item.key === dest);
  const navLabel = dict.nav[dest];
  const t = dict.pages.placeholder;

  if (!destination || !destination.planned) {
    return (
      <section className="border-border bg-card rounded-(--radius-card) border p-5">
        <h1 className="text-xl font-semibold">{navLabel}</h1>
        <p className="text-muted-foreground mt-2 text-sm">{dict.errors.loginRequiredBody}</p>
      </section>
    );
  }

  const planned = destination.planned;

  return (
    <>
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{navLabel}</h1>
        <p className="text-muted-foreground mt-1 text-sm">{t.title}</p>
      </header>

      <section className="border-border bg-card mt-5 rounded-(--radius-card) border p-5 text-sm">
        <p className="text-muted-foreground">{t.body}</p>
        <dl className="mt-4 grid gap-2 sm:grid-cols-2">
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground">{t.phaseLabel}</dt>
            <dd className="text-foreground ltr-island font-mono" dir="ltr">
              {planned.phase}
            </dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground">{t.gateLabel}</dt>
            <dd className="text-foreground ltr-island font-mono" dir="ltr">
              {planned.gate}
            </dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground">docs/PLAN.md</dt>
            <dd className="text-foreground ltr-island font-mono" dir="ltr">
              {planned.workItems}
            </dd>
          </div>
          <div className="flex items-baseline gap-3">
            <dt className="text-muted-foreground">path</dt>
            <dd className="text-foreground ltr-island font-mono" dir="ltr">
              {destination.path}
            </dd>
          </div>
        </dl>
      </section>
    </>
  );
}
