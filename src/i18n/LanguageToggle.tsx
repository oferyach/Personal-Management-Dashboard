import { setLocaleAction } from "./actions";
import { dirOf, langOf, otherLocale, type Locale } from "./locales";
import type { Dictionary } from "./dictionaries";

/**
 * Language switch control. Renders the *other* language in its own script
 * ("English" on a Hebrew page, "עברית" on an English page) so the option is
 * recognizable regardless of the current UI language.
 *
 * It is a real form POST to a server action, not a decorative button.
 */
export function LanguageToggle({
  locale,
  dict,
  nextPath = "/",
}: {
  locale: Locale;
  dict: Dictionary;
  nextPath?: string;
}) {
  const target = otherLocale(locale);

  return (
    <form
      action={setLocaleAction}
      aria-label={dict.ui.language.switchTo}
      className="border-border bg-card inline-flex items-center gap-2 rounded-full border px-1 py-1"
    >
      <span className="text-muted-foreground px-2 text-xs font-medium">
        {dict.ui.language.label}
      </span>
      <input type="hidden" name="locale" value={target} />
      <input type="hidden" name="next" value={nextPath} />
      <button
        type="submit"
        className="text-accent rounded-full px-3 py-1 text-sm font-medium underline-offset-4 hover:underline"
        lang={langOf(target)}
        // The option label itself is always LTR-or-RTL in its own language.
        dir={dirOf(target)}
      >
        {dict.ui.language[target]}
      </button>
    </form>
  );
}
