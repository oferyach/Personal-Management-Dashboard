import { describe, expect, it } from "vitest";
import {
  LOCALES,
  LOCALE_COOKIE,
  LOCALE_COOKIE_MAX_AGE_SECONDS,
  FALLBACK_LOCALE,
  dirOf,
  isLocale,
  isRtl,
  langOf,
  otherLocale,
  resolveLocale,
} from "@/i18n/locales";
import { en } from "@/i18n/dictionaries/en";
import { he, getDictionary, keyPaths } from "@/i18n/dictionaries";

/**
 * Hebrew is the primary UI language and English the secondary one (spec §4 as
 * amended). These tests are the guard: they fail if a menu label drifts back to
 * English, if a key exists in one language only, or if RTL stops being derived
 * from the locale instead of being hard-coded somewhere.
 */

const HEBREW = /[\u0590-\u05FF]/;
/** Brand names that are never translated, in either language. */
const UNTRANSLATED_BRANDS = new Set(["OneDrive"]);

function leaves(value: unknown, path = ""): Array<{ path: string; text: string }> {
  if (value === null || typeof value !== "object") {
    return [{ path, text: value as string }];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leaves(child, path ? `${path}.${key}` : key),
  );
}

describe("locale model", () => {
  it("Hebrew is the fallback language and the RTL one", () => {
    expect(FALLBACK_LOCALE).toBe("he");
    expect(LOCALES[0]).toBe("he");
    expect(isRtl("he")).toBe(true);
    expect(isRtl("en")).toBe(false);
    expect(dirOf("he")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
  });

  it("emits explicit BCP-47 tags so assistive tech gets the right language", () => {
    expect(langOf("he")).toBe("he-IL");
    expect(langOf("en")).toBe("en");
  });

  it("offers the other supported language in both directions", () => {
    expect(otherLocale("he")).toBe("en");
    expect(otherLocale("en")).toBe("he");
  });

  it("never lets an unvalidated locale through", () => {
    expect(isLocale("he")).toBe(true);
    for (const bad of ["fr", "he-IL", "", "en-US", "rtl", undefined, null, 42, "he'"] as const) {
      expect(isLocale(bad)).toBe(false);
    }
  });

  it("resolves user choice first, then the operator default, then Hebrew", () => {
    expect(resolveLocale("en", "he")).toBe("en");
    expect(resolveLocale("he", "en")).toBe("he");
    expect(resolveLocale(undefined, "en")).toBe("en");
    expect(resolveLocale("de", "en")).toBe("en");
    expect(resolveLocale("de", "de")).toBe("he");
    expect(resolveLocale(undefined, undefined)).toBe("he");
  });

  it("names the preference cookie and keeps it durable", () => {
    expect(LOCALE_COOKIE).toBe("pmd_locale");
    expect(LOCALE_COOKIE_MAX_AGE_SECONDS).toBeGreaterThanOrEqual(60 * 60 * 24 * 30);
  });
});

describe("dictionaries", () => {
  it("Hebrew and English have exactly the same keys", () => {
    const heKeys = keyPaths(he);
    const enKeys = keyPaths(en);
    expect(heKeys.length).toBeGreaterThan(40);
    expect(enKeys).toEqual(heKeys);
  });

  it("has no empty or HTML-bearing translation strings", () => {
    for (const { path, text } of leaves(he)) {
      expect(typeof text, path).toBe("string");
      expect(text.trim().length, path).toBeGreaterThan(0);
      expect(text, path).not.toMatch(/[<>]/);
    }
    for (const { path, text } of leaves(en)) {
      expect(text.trim().length, path).toBeGreaterThan(0);
      expect(text, path).not.toMatch(/[<>]/);
    }
  });

  it("renders every main-menu label (spec §4) in Hebrew", () => {
    const labels = Object.entries(he.nav);
    // heading + the 11 menu items listed in the spec
    expect(labels.length).toBeGreaterThanOrEqual(12);

    for (const [key, label] of labels) {
      if (UNTRANSLATED_BRANDS.has(label)) continue;
      expect(HEBREW.test(label), `nav.${key} = "${label}" must be Hebrew`).toBe(true);
    }

    expect(he.nav.dashboard).toBe("לוח מחוונים");
    expect(he.nav.calendar).toBe("לוח שנה");
    expect(he.nav.tasks).toBe("משימות");
    expect(he.nav.projects).toBe("פרויקטים");
    expect(he.nav.assets).toBe("נכסים");
    expect(he.nav.notifications).toBe("התראות");
    expect(he.nav.activity).toBe("היסטוריית פעילות");
    expect(he.nav.usersRoles).toBe("משתמשים ותפקידים");
    expect(he.nav.settings).toBe("הגדרות");
    expect(he.nav.profile).toBe("פרופיל אישי");
  });

  it("keeps the Hebrew UI free of English menu and status wording", () => {
    // Labels that are brand/product names by design and stay Latin in every locale.
    const LATIN_ONLY_LABELS = new Set(["OneDrive", "SMTP", "Node"]);

    const sections: Array<{ name: string; value: unknown }> = [
      { name: "nav", value: he.nav },
      { name: "status", value: he.status },
      { name: "states", value: he.states },
      { name: "ui", value: he.ui },
      { name: "app", value: he.app },
      { name: "notFound", value: he.notFound },
    ];

    for (const section of sections) {
      for (const { path, text } of leaves(section.value, section.name)) {
        // A language switch always shows both languages in their own script.
        if (path.startsWith("ui.language.")) continue;
        const isLatinOnly = /^[A-Za-z0-9 .&:/()-]+$/.test(text);
        if (isLatinOnly) {
          expect(LATIN_ONLY_LABELS.has(text.trim()), `${path} = "${text}" must be Hebrew`).toBe(
            true,
          );
          continue;
        }
        expect(HEBREW.test(text), `${path} = "${text}" must be Hebrew`).toBe(true);
      }
    }
  });

  it("keeps the English secondary dictionary Latin (except its own language names)", () => {
    for (const { path, text } of leaves(en)) {
      if (path.startsWith("ui.language.")) continue;
      expect(HEBREW.test(text), `en.${path} = "${text}" must not be Hebrew`).toBe(false);
    }
  });

  it("shows each language in its own script in the language switch", () => {
    expect(he.ui.language.he).toBe("עברית");
    expect(he.ui.language.en).toBe("English");
    expect(en.ui.language.he).toBe("עברית");
    expect(en.ui.language.en).toBe("English");
  });

  it("maps every locale to its dictionary", () => {
    expect(getDictionary("he")).toBe(he);
    expect(getDictionary("en")).toBe(en);
  });
});
