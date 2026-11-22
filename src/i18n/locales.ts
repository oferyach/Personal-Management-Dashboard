/**
 * Locale plumbing (spec §4 "Language support", amended 2026-11-22:
 * Hebrew is the PRIMARY language, English is secondary).
 *
 * Rules:
 *  - Every locale id maps to a `lang` attribute and a `dir` value. The `dir`
 *    flip on <html> is the ONLY thing that changes layout direction, because
 *    all spacing/alignment in CSS uses logical properties.
 *  - Hebrew is the default. A locale can only ever come from a validated set:
 *    cookie (user choice) > DEFAULT_LANGUAGE (operator default) > "he".
 *  - Dictionaries live in `src/i18n/dictionaries/`. Hebrew is the source of
 *    truth for the key shape; `en` is typed against it so a missing English
 *    string is a compile error, not a runtime English leak in a Hebrew UI.
 */

export const LOCALES = ["he", "en"] as const;
export type Locale = (typeof LOCALES)[number];

/** Fallback when nothing else is valid. Hebrew first: it is the primary UI language. */
export const FALLBACK_LOCALE: Locale = "he";

export const LOCALE_COOKIE = "pmd_locale";
export const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

const RTL_LOCALES: ReadonlySet<Locale> = new Set<Locale>(["he"]);

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function isRtl(locale: Locale): boolean {
  return RTL_LOCALES.has(locale);
}

/** Value for <html dir>. */
export function dirOf(locale: Locale): "rtl" | "ltr" {
  return isRtl(locale) ? "rtl" : "ltr";
}

/** Value for <html lang> — explicit BCP-47 so screen readers pick the right voice. */
export function langOf(locale: Locale): string {
  return locale === "he" ? "he-IL" : "en";
}

/** The language a switch control should offer: the other supported locale. */
export function otherLocale(locale: Locale): Locale {
  return locale === "he" ? "en" : "he";
}

/**
 * Pure resolver, unit tested. Priority: user choice, then operator default,
 * then the primary language. Invalid values never reach the DOM.
 */
export function resolveLocale(
  candidate: string | undefined | null,
  fallback: string | undefined = FALLBACK_LOCALE,
): Locale {
  if (isLocale(candidate)) return candidate;
  if (isLocale(fallback)) return fallback;
  return FALLBACK_LOCALE;
}
