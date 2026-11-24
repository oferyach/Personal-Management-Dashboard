import { cookies, headers } from "next/headers";
import { getConfig } from "@/lib/env";
import { resolveSessionState } from "@/lib/sessions";
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

export async function accountLanguage(requestHeaders: Headers): Promise<Locale | null> {
  const state = await resolveSessionState(requestHeaders);
  if (state.kind === "anonymous") return null;
  return readPreferences(state.user.id).language;
}

export async function resolveRequestLocale(): Promise<Locale> {
  const account = await accountLanguage(await headers());
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
