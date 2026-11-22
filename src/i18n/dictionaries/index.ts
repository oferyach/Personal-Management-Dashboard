import { he } from "./he";
import { en } from "./en";
import type { Locale } from "../locales";
import type { Dictionary } from "./types";

/**
 * Dictionaries are static modules, not JSON fetched at runtime: a missing
 * translation is a compile-time error and the app never ships a half-empty UI.
 *
 * `he` is the source of truth for the key shape (Hebrew is the primary
 * language); `en` is typed against that shape.
 */

export type { Dictionary } from "./types";

export { he } from "./he";

const dictionaries: Record<Locale, Dictionary> = { he, en };

/** Total lookup: adding a locale to LOCALES forces a dictionary here. */
export function getDictionary(locale: Locale): Dictionary {
  return dictionaries[locale];
}

/** Every leaf key path of a dictionary, sorted. Used by the parity unit test. */
export function keyPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object") return [prefix];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => keyPaths(child, prefix ? `${prefix}.${key}` : key))
    .sort();
}
