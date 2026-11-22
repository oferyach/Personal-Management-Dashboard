"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getConfig } from "@/lib/env";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE_SECONDS, isLocale, type Locale } from "./locales";

/**
 * Language switch (spec §4 + §17). A plain HTML form + server action: no
 * client-side JavaScript, which keeps working under the production CSP
 * (`script-src 'self' 'nonce-…'`) and on a phone with JS disabled.
 */

/** Same-origin relative paths only — never an attacker-supplied redirect target. */
function safeReturnPath(value: unknown): string {
  const path = typeof value === "string" ? value : "";
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return "/";
  return path;
}

export async function setLocaleAction(formData: FormData): Promise<void> {
  const target = formData.get("locale");
  const nextPath = safeReturnPath(formData.get("next"));

  // An unknown or forged locale must not be stored; just go back where we came from.
  if (!isLocale(target)) redirect(nextPath);

  const locale: Locale = target;
  const appUrl = getConfig().appUrl;

  (await cookies()).set(LOCALE_COOKIE, locale, {
    path: "/",
    maxAge: LOCALE_COOKIE_MAX_AGE_SECONDS,
    httpOnly: true,
    sameSite: "lax",
    // Only mark it Secure when the app is really served over HTTPS (spec §20),
    // otherwise the switch would be silently dropped on a local http:// origin.
    secure: appUrl.startsWith("https://"),
  });

  redirect(nextPath);
}
