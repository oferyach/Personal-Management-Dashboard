import type { he } from "./he";

/**
 * The Hebrew dictionary shape with every leaf widened from a literal to string.
 * `en` (and any later locale) is typed against this, so dictionaries stay in
 * lockstep: a missing, extra or renamed key fails the build.
 */
export type DeepStrings<T> = T extends string ? string : { [K in keyof T]: DeepStrings<T[K]> };

export type Dictionary = DeepStrings<typeof he>;
