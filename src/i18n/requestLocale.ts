import { cookies } from "next/headers";
import { getConfig } from "@/lib/env";
import { readSessionByToken, SESSION_COOKIE_NAME } from "@/lib/sessions";
import { readPreferences } from "@/lib/preferences";
import { LOCALE_COOKIE, resolveLocale, type Locale } from "./locales";
import { getDictionary, type Dictionary } from "./dictionaries";

/**
 * Server-side locale resolution (spec §4 + §17 "Language preference").
 *
 * The choice is read from a cookie here; from Phase 1 it is read from the
 * signed-in user's profile and mirrored into the cookie, so a preference set
 * once follows the user across devices instead of living per-browser.
 *
 * Resolution happens on the server so the very first byte of HTML is already
 * in the right language and direction — no client-side flip, no flash of
 * English on a Hebrew account.
 */

async function accountLanguage(): Promise<Locale | null> {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;
  const found = readSessionByToken(token);
  if (!found) return null;
  return readPreferences(found.user.id).language;
}

export async function resolveRequestLocale(): Promise<Locale> {
  const account = await accountLanguage();
  const stored = (await cookies()).get(LOCALE_COOKIE)?.value;
  return resolveLocale(account ?? stored, getConfig().defaultLanguage);
}

export interface I18nContext {
  locale: Locale;
  dict: Dictionary;
}

export async function getI18n(): Promise<I18nContext> {
  const locale = await resolveRequestLocale();
  return { locale, dict: getDictionary(locale) };
}
