import "server-only";
import { eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { user_preferences } from "@/db/schema";
import { isLocale, type Locale } from "@/i18n/locales";
import { getConfig } from "@/lib/env";

/**
 * Work item 1.9 — per-account preferences. Stored in `user_preferences`, one row per
 * user. A NULL language means "follow the server default", which is what keeps the
 * Hebrew-first rule (amendment A-2) intact for accounts that never chose anything.
 */
export interface Preferences {
  language: Locale | null;
  timezone: string;
  workweekDays: number;
  workdayStartHour: number;
  workdayEndHour: number;
  defaultTaskReminderOffsets: number[];
  defaultCalendarReminderOffsets: number[];
  theme: Theme;
  updatedAt: string | null;
}

/** 1.9: a stored choice of light/dark. `system` keeps the CSS media query in charge. */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

const REMINDER_OFFSETS = [15, 60, 1440] as const;

function offsets(value: string): number[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is number => typeof item === "number" && item >= 0);
  } catch {
    return [];
  }
}

export function readPreferences(userId: string): Preferences {
  const config = getConfig();
  const row = getDb()
    .select()
    .from(user_preferences)
    .where(eq(user_preferences.userId, userId))
    .get();

  if (!row) {
    return {
      language: null,
      timezone: config.defaultTimezone,
      workweekDays: 5,
      workdayStartHour: 9,
      workdayEndHour: 17,
      defaultTaskReminderOffsets: [15, 60],
      defaultCalendarReminderOffsets: [15, 60],
      theme: "system",
      updatedAt: null,
    };
  }

  return {
    language: isLocale(row.language) ? row.language : null,
    timezone: row.timezone,
    workweekDays: row.workweekDays,
    workdayStartHour: row.workdayStartHour,
    workdayEndHour: row.workdayEndHour,
    defaultTaskReminderOffsets: offsets(row.defaultTaskReminderOffsets),
    defaultCalendarReminderOffsets: offsets(row.defaultCalendarReminderOffsets),
    theme: isTheme(row.theme) ? row.theme : "system",
    updatedAt: row.updatedAt,
  };
}

export interface PreferencesInput {
  language?: Locale | null;
  timezone?: string;
  workweekDays?: number;
  workdayStartHour?: number;
  workdayEndHour?: number;
  defaultTaskReminderOffsets?: number[];
  defaultCalendarReminderOffsets?: number[];
  theme?: Theme;
}

export class PreferenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PreferenceError";
  }
}

function normalizeOffsets(values: number[] | undefined, label: string): string {
  const list = values ?? [];
  if (!list.every((value) => Number.isInteger(value) && value >= 0 && value <= 10080)) {
    throw new PreferenceError(
      `${label}: reminder offsets must be whole minutes between 0 and 10080.`,
    );
  }
  return JSON.stringify([...new Set(list)].sort((a, b) => a - b));
}

/** The single write path for preferences, shared by the profile page and the API. */
export function savePreferences(userId: string, input: PreferencesInput): Preferences {
  const current = readPreferences(userId);
  const now = new Date().toISOString();

  if (input.language !== undefined && input.language !== null && !isLocale(input.language)) {
    throw new PreferenceError(`Unknown language "${String(input.language)}".`);
  }
  if (input.workweekDays !== undefined && ![5, 6, 7].includes(input.workweekDays)) {
    throw new PreferenceError("workweekDays must be 5, 6 or 7.");
  }
  if (input.theme !== undefined && !isTheme(input.theme)) {
    throw new PreferenceError(`Unknown theme "${String(input.theme)}".`);
  }
  for (const [name, value] of [
    ["workdayStartHour", input.workdayStartHour],
    ["workdayEndHour", input.workdayEndHour],
  ] as const) {
    if (value !== undefined && (!Number.isInteger(value) || value < 0 || value > 23)) {
      throw new PreferenceError(`${name} must be an hour between 0 and 23.`);
    }
  }
  if (
    input.workdayStartHour !== undefined &&
    input.workdayEndHour !== undefined &&
    input.workdayStartHour >= input.workdayEndHour
  ) {
    throw new PreferenceError("workdayStartHour must be earlier than workdayEndHour.");
  }
  if (input.timezone !== undefined) {
    try {
      new Intl.DateTimeFormat("en", { timeZone: input.timezone }).format(new Date());
    } catch {
      throw new PreferenceError(`Unknown time zone "${input.timezone}".`);
    }
  }

  const values = {
    language: input.language === undefined ? current.language : input.language,
    timezone: input.timezone ?? current.timezone,
    workweekDays: input.workweekDays ?? current.workweekDays,
    workdayStartHour: input.workdayStartHour ?? current.workdayStartHour,
    workdayEndHour: input.workdayEndHour ?? current.workdayEndHour,
    defaultTaskReminderOffsets: normalizeOffsets(
      input.defaultTaskReminderOffsets ?? current.defaultTaskReminderOffsets,
      "task reminders",
    ),
    defaultCalendarReminderOffsets: normalizeOffsets(
      input.defaultCalendarReminderOffsets ?? current.defaultCalendarReminderOffsets,
      "calendar reminders",
    ),
    theme: input.theme ?? current.theme,
    updatedAt: now,
  };

  getDb()
    .insert(user_preferences)
    .values({ ...values, userId })
    .onConflictDoUpdate({ target: user_preferences.userId, set: values })
    .run();

  return readPreferences(userId);
}

export const ALLOWED_REMINDER_OFFSETS: readonly number[] = REMINDER_OFFSETS;
