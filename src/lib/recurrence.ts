/**
 * Recurrence engine (packet 2E) — pure functions, no database access, no Next
 * APIs. Everything that decides "when does this series next happen" lives here,
 * so the repository in `src/lib/recurrenceStore.ts` stays a thin writer and the
 * agenda in `src/lib/events.ts` stays a query. The decision it implements is
 * `docs/adr/0002-recurrence-expansion.md`, which packet 2F must read before it
 * creates `event_recurrence_rules`.
 *
 * The one decision this module exists for: **a recurring event is stored as a
 * rule plus a zone, and expansion happens in wall-clock space, then resolves to
 * instants.** Expanding instants directly (UTC + 24h) is what makes calendar apps
 * drift an hour on a DST Sunday; expanding wall fields and resolving each one
 * through the event's IANA zone is what keeps `09:00` meaning 09:00 local.
 *
 * Measured against the installed `rrule` 2.8.1 (`node_modules/rrule/dist/es5/rrule.js`),
 * which is why the code below looks the way it does:
 *  - `rrulestr` preserves the **UTC fields of `dtstart`** as the wall clock and
 *    returns Dates whose UTC fields are the next wall clock, identically under
 *    `TZ=UTC` and `TZ=America/New_York` — so wall stamps are carried as
 *    `Date.UTC(...)` values and never as local-time Dates;
 *  - `rrulestr` is lenient: `FREQ=HOURLY`, `BYSETPOS`, `RDATE` and `MINUTELY`
 *    all parse. The subset a series may use is therefore validated **here**, and
 *    `rrule` is only ever asked to expand something already vetted;
 *  - `RRULE` strings cannot carry `EXDATE` ("unsupported property"), so exceptions
 *    are a repository concern (packet 2E's `event_occurrence_exceptions`), not a
 *    rule-string concern;
 *  - `rule.between(a, b)` is **exclusive at both ends**, so a window is passed as
 *    `(from - 1ms, to)`;
 *  - `RRuleSet.exdate(date)` is the exception primitive, and it matches on the
 *    wall stamp, which is exactly what an exception row means.
 *
 * Traceability: `README.md` §6 ("Recurring events must support: daily, weekly,
 * monthly, yearly, custom interval; … DST correctness … month-end correctness …
 * leap year correctness"), `docs/PLAN.md` §6 (2.3 "Recurrence engine (bounded or
 * capped expansion; DST, month-end, leap-year correctness)"), `docs/ARCHITECTURE.md`
 * §3 ("All timestamps stored UTC in ISO-8601 TEXT"; "the user's IANA zone … is
 * applied only at rendering and scheduling boundaries").
 */
import { RRule } from "rrule";
import type { Options, Weekday } from "rrule";

/** The four frequencies a series may use (`README.md` §6). */
export const RECURRENCE_FREQUENCIES = ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"] as const;
export type RecurrenceFrequency = (typeof RECURRENCE_FREQUENCIES)[number];

/**
 * Weekday vocabulary. `rrule` accepts `SU`..`SA` with an optional occurrence
 * prefix; the README lists `MO..SU`, and the engine's default week start is
 * Monday (`rrule`'s `wkst` default is `MO`), so `BYDAY=MO` is "the Monday of the
 * week that contains the anchor", measured below.
 */
const WEEK_DAYS = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"] as const;

/**
 * Cap on occurrences materialized per event. A daily series over the 2026-2027
 * calendar year is 365 rows; 730 is "two full years of the most frequent legal
 * series", so a legitimate series never hits it while a mistyped
 * `FREQ=SECONDLY`-shaped rule cannot exhaust the transaction. `docs/PLAN.md` §6
 * 2.3 requires expansion be "bounded or capped"; this is the cap.
 */
export const MAX_SERIES_OCCURRENCES = 730;
/** Upper bound on `INTERVAL`, so `FREQ=YEARLY;INTERVAL=999999` is rejected early. */
export const MAX_RECURRENCE_INTERVAL = 1000;
/** Upper bound on a `COUNT`-bounded series, independent of the window. */
export const MAX_RECURRENCE_COUNT = MAX_SERIES_OCCURRENCES;
/** `EXDATE` entries a rule may carry; keeps the stored text bounded. */
export const MAX_RECURRENCE_EXDATES = 100;

export type RecurrenceStatus = "ok" | "invalid" | "truncated";

/**
 * A wall clock — "09:00 on 2026-11-30" with no zone attached. Carried as the
 * `Date.UTC(...)` value of those calendar fields, which is only ever a device
 * convention for "the field-wise comparison of a wall stamp"; it is converted to
 * a real instant exactly once, by `instantiateWall`.
 */
export interface WallClock {
  ms: number;
  /** Canonical `YYYY-MM-DDTHH:MM:SS`, the form stored in `event_recurrence`. */
  text: string;
}

const WALL_SHAPE = /^(\d{4})-(\d{2})-(\d{2})[T](\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Parses a wall stamp. Deliberately rejects any offset or `Z`: a rule that carried
 * an absolute instant could not be re-expanded in a different zone, which is the
 * whole point of storing the zone separately.
 */
export function parseWall(value: unknown): WallClock | null {
  if (typeof value !== "string") return null;
  const m = WALL_SHAPE.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, H, M, S] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(H), Number(M), Number(S ?? 0));
  const back = new Date(ms);
  // Reject 2026-02-31 etc.: the round-trip has to reproduce the input fields.
  if (
    back.getUTCFullYear() !== Number(y) ||
    back.getUTCMonth() !== Number(mo) - 1 ||
    back.getUTCDate() !== Number(d) ||
    back.getUTCHours() !== Number(H) ||
    back.getUTCMinutes() !== Number(M) ||
    back.getUTCSeconds() !== Number(S ?? 0)
  ) {
    return null;
  }
  return { ms, text: new Date(ms).toISOString().slice(0, 19) };
}

/** `2026-11-30` + `09:00` → wall clock, the shape the API accepts for a series. */
export function wallOf(date: unknown, time: unknown): WallClock | null {
  if (typeof date !== "string" || typeof time !== "string") return null;
  return parseWall(`${date.trim()}T${time.trim()}`);
}

/** Wall fields of an instant in `zone`, as `YYYY-MM-DDTHH:MM:SS`. */
export function wallTextOf(instant: number, zone: string): string | null {
  const parts = wallParts(instant, zone);
  if (!parts) return null;
  return `${parts.date}T${parts.time}`;
}

const FORMATTERS = new Map<string, { ok: true; format: Intl.DateTimeFormat } | { ok: false }>();

/**
 * Cached formatter per zone. An invalid IANA id makes the constructor throw
 * `RangeError`, which is turned into a negative cache entry rather than an
 * exception: `events.timezone` is a free-text column with only a length CHECK
 * (`docs/ARCHITECTURE.md` §3 does not require a zone dictionary), so a bad zone
 * has to degrade to "this series cannot be expanded", not "the agenda 500s".
 */
function formatterFor(zone: string): { ok: true; format: Intl.DateTimeFormat } | { ok: false } {
  const cached = FORMATTERS.get(zone);
  if (cached) return cached;
  try {
    const format = new Intl.DateTimeFormat("en-GB", {
      timeZone: zone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "longOffset",
    });
    const entry = { ok: true as const, format };
    FORMATTERS.set(zone, entry);
    return entry;
  } catch {
    const entry = { ok: false as const };
    FORMATTERS.set(zone, entry);
    return entry;
  }
}

export function isValidZone(zone: unknown): zone is string {
  return typeof zone === "string" && formatterFor(zone).ok;
}

interface WallParts {
  date: string;
  time: string;
  offsetMs: number;
}

/** Wall fields plus the zone's offset at that instant. `null` for a bad zone. */
function wallParts(instant: number, zone: string): WallParts | null {
  const entry = formatterFor(zone);
  if (!entry.ok) return null;
  const parts = entry.format.formatToParts(new Date(instant));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const label = get("timeZoneName"); // "GMT+02:00", "GMT+03:00", or "GMT"
  const body = /^GMT([+-]\d{2}(?::\d{2})?)?$/.exec(label)?.[1] ?? "";
  const sign = body.startsWith("-") ? -1 : 1;
  const digits = body.replace(/^[+-]/, "").replace(":", "");
  const hours = digits ? Number(digits.slice(0, 2)) : 0;
  const minutes = digits.length > 2 ? Number(digits.slice(2)) : 0;
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let time = `${get("hour")}:${get("minute")}:${get("second")}`;
  // `hourCycle: "h23"` still renders midnight as "24:00" in some ICU versions.
  if (time.startsWith("24:")) time = `00:${time.slice(3)}`;
  return { date, time, offsetMs: sign * (hours * 3600 + minutes * 60) * 1000 };
}

/** Offset (`instant + offset = wall`) the zone uses at `instant`. */
export function zoneOffsetMs(instant: number, zone: string): number | null {
  const parts = wallParts(instant, zone);
  return parts ? parts.offsetMs : null;
}

export type WallResolution =
  | { kind: "exact"; instant: number }
  /** Two instants share this wall clock (fall-back hour): the earlier one wins. */
  | { kind: "ambiguous"; instant: number; other: number }
  /** No instant has this wall clock (spring-forward gap): the shifted-forward one wins. */
  | { kind: "gap"; instant: number; shiftedByMs: number };

/**
 * The offsets a zone uses across an instant window, largest first.
 *
 * Sampling is what makes this cheap and complete: an offset is piecewise-constant,
 * so one probe per step catches every offset in effect inside the window plus a
 * ±26h margin (26h exceeds any real UTC offset, so a candidate that could resolve
 * inside the window always has its offset in the set). The step is sized so the
 * work stays bounded for a two-year rebuild — `MAX_SERIES_OCCURRENCES` windows
 * would otherwise cost thousands of `Intl` calls.
 */
export function zoneOffsetsInWindow(zone: string, from: number, to: number): number[] | null {
  if (!isValidZone(zone)) return null;
  const margin = 26 * 3600_000;
  const span = Math.max(to, from) + margin - (from - margin);
  // ≤ 400 probes regardless of window length; ≥ 6h apart, which is finer than any
  // real zone's transition spacing (they are ≥ 10 days apart in practice).
  const step = Math.max(6 * 3600_000, Math.floor(span / 400));
  const offsets = new Set<number>();
  for (let t = from - margin; t <= to + margin; t += step) {
    const offset = zoneOffsetMs(t, zone);
    if (offset === null) return null;
    offsets.add(offset);
  }
  return [...offsets].sort((a, b) => b - a);
}

/**
 * Wall clock → instant, given the offsets the zone uses in the surrounding window.
 *
 * Every offset in the window yields a candidate (`wall - offset`); the one whose
 * wall rendering round-trips to the requested stamp is the real answer. That set
 * is exactly the RFC 5544/5545 trichotomy:
 *  - one round-trip → an ordinary instant;
 *  - two round-trips → a fall-back overlap; the **earlier** instant wins, which is
 *    what makes a 02:30 occurrence in Asia/Jerusalem on 2026-10-25 the +03:00 one;
 *  - none → a spring-forward gap; the **later** candidate wins, i.e. the stamp is
 *    shifted forward past the transition, so a series landing in the 02:00-02:59
 *    gap of 2026-03-27 still produces an occurrence instead of vanishing.
 *
 * A two-candidate probe alone is not enough: for the Jerusalem fall-back hour both
 * guesses converge on the *later* instant, so the earlier one is never seen. Probing
 * the window's offset set is what makes the overlap detectable.
 */
function wallStampOf(instant: number, zone: string): number | null {
  const text = wallTextOf(instant, zone);
  return text === null ? null : Date.parse(text);
}

/**
 * The first instant whose wall clock is strictly past `wall`, searched inside
 * `[wall - maxOffset, wall - minOffset]` — the only range that can contain the
 * transition which skipped `wall`. Wall clocks are monotone non-decreasing in the
 * instant, so bisection is sound; the range is at most 52h, so ~25 probes.
 * Returns null if the measured endpoints do not bracket the gap, in which case
 * the caller keeps its latest-candidate fallback rather than guessing.
 */
function firstInstantPastWall(wall: number, zone: string, offsets: number[]): number | null {
  let lo = wall - Math.max(...offsets);
  let hi = wall - Math.min(...offsets);
  const loWall = wallStampOf(lo, zone);
  const hiWall = wallStampOf(hi, zone);
  if (loWall === null || hiWall === null || loWall > wall || hiWall <= wall) return null;
  while (hi - lo > 1) {
    const mid = lo + Math.floor((hi - lo) / 2);
    const midWall = wallStampOf(mid, zone);
    if (midWall === null) return null;
    if (midWall > wall) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function instantiateWallWith(
  wall: number,
  zone: string,
  offsets: number[],
): WallResolution | null {
  const target = new Date(wall).toISOString().slice(0, 19);
  const resolving: number[] = [];
  let best = Number.NaN;
  for (const offset of offsets) {
    const candidate = wall - offset;
    if (wallTextOf(candidate, zone) === target) resolving.push(candidate);
    if (Number.isNaN(best) || candidate > best) best = candidate;
  }
  if (resolving.length === 0) {
    // Spring-forward gap. `best` is only the latest candidate, which lands *inside*
    // the shifted hour; the RFC 5544 `gap_start` rule wants the transition instant
    // itself, so the boundary is found by bisecting the monotone wall predicate.
    const boundary = firstInstantPastWall(wall, zone, offsets);
    if (boundary === null) {
      return {
        kind: "gap",
        instant: best,
        shiftedByMs: best - Math.min(...offsets.map((o) => wall - o)),
      };
    }
    return { kind: "gap", instant: boundary, shiftedByMs: wallStampOf(boundary, zone)! - wall };
  }
  const earliest = Math.min(...resolving);
  if (resolving.length === 1) return { kind: "exact", instant: earliest };
  return { kind: "ambiguous", instant: earliest, other: Math.max(...resolving) };
}

/** Convenience wrapper: probes the offsets around a single stamp (±26h, 6h apart). */
export function instantiateWall(wall: number, zone: string): WallResolution | null {
  if (!isValidZone(zone)) return null;
  const offsets: number[] = [];
  for (let delta = -26 * 3600_000; delta <= 26 * 3600_000; delta += 6 * 3600_000) {
    const offset = zoneOffsetMs(wall + delta, zone);
    if (offset === null) return null;
    if (!offsets.includes(offset)) offsets.push(offset);
  }
  return instantiateWallWith(wall, zone, offsets);
}

/**
 * A validated series rule. This is the shape `event_recurrence.rule` round-trips
 * to: the column stores the canonical `RRULE` text, `validateRule` is what decides
 * whether a user-supplied rule is admissible at all, and `parseRuleText` is the
 * only reader of that column. `rrulestr` is never used as a validator — measured,
 * it accepts `FREQ=HOURLY`, `BYSETPOS`, `RDATE` and `MINUTELY` without complaint,
 * and a `SECONDLY` series would silently blow up the occurrence cap instead of
 * failing the request.
 */
export interface SeriesRule {
  freq: RecurrenceFrequency;
  interval: number;
  byDay: string[];
  byMonth: number[];
  byMonthDay: number[];
  /** `COUNT` bound, in occurrences. */
  count: number | null;
  /** `UNTIL` bound, as a wall clock (never an instant). */
  until: WallClock | null;
  /** Cancelled occurrences, as wall clocks in the series' zone, ascending. */
  exdates: string[];
}

const WEEKDAY_BY_NAME: Record<string, Weekday> = {
  MO: RRule.MO,
  TU: RRule.TU,
  WE: RRule.WE,
  TH: RRule.TH,
  FR: RRule.FR,
  SA: RRule.SA,
  SU: RRule.SU,
};

const FREQ_BY_NAME: Record<string, number> = {
  DAILY: RRule.DAILY,
  WEEKLY: RRule.WEEKLY,
  MONTHLY: RRule.MONTHLY,
  YEARLY: RRule.YEARLY,
};

const RULE_KEYS = [
  "freq",
  "interval",
  "byDay",
  "byMonth",
  "byMonthDay",
  "count",
  "until",
  "exdates",
] as const;

export type RuleRejection =
  | "rule_shape"
  | "rule_property"
  | "rule_frequency"
  | "rule_interval"
  | "rule_byday"
  | "rule_bymonth"
  | "rule_bymonthday"
  | "rule_bound"
  | "rule_exdate";

/**
 * Validates the admissible subset (`README.md` §6: "daily, weekly, monthly, yearly,
 * custom interval"). Unknown properties are rejected rather than ignored: an
 * unvalidated `BYSETPOS=-1` or `WKST` would expand fine here and then serialize
 * into `.ics` (packet 2.5) as something the calendar application may interpret
 * differently.
 */
export function validateRule(
  input: unknown,
): { ok: true; rule: SeriesRule } | { ok: false; reason: RuleRejection } {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return { ok: false, reason: "rule_shape" };
  const source = input as Record<string, unknown>;
  for (const key of Object.keys(source)) {
    if (!RULE_KEYS.includes(key as (typeof RULE_KEYS)[number]))
      return { ok: false, reason: "rule_property" };
  }
  if (!RECURRENCE_FREQUENCIES.includes(source.freq as RecurrenceFrequency))
    return { ok: false, reason: "rule_frequency" };

  const interval = source.interval === undefined || source.interval === null ? 1 : source.interval;
  if (
    typeof interval !== "number" ||
    !Number.isInteger(interval) ||
    interval < 1 ||
    interval > MAX_RECURRENCE_INTERVAL
  ) {
    return { ok: false, reason: "rule_interval" };
  }

  const byDay = source.byDay ?? [];
  if (
    !Array.isArray(byDay) ||
    byDay.length > WEEK_DAYS.length ||
    new Set(byDay).size !== byDay.length
  ) {
    return { ok: false, reason: "rule_byday" };
  }
  for (const day of byDay)
    if (!WEEK_DAYS.includes(day as (typeof WEEK_DAYS)[number]))
      return { ok: false, reason: "rule_byday" };

  const byMonth = source.byMonth ?? [];
  if (!Array.isArray(byMonth) || byMonth.length > 12 || new Set(byMonth).size !== byMonth.length) {
    return { ok: false, reason: "rule_bymonth" };
  }
  for (const month of byMonth)
    if (typeof month !== "number" || !Number.isInteger(month) || month < 1 || month > 12)
      return { ok: false, reason: "rule_bymonth" };

  const byMonthDay = source.byMonthDay ?? [];
  if (
    !Array.isArray(byMonthDay) ||
    byMonthDay.length > 31 ||
    new Set(byMonthDay).size !== byMonthDay.length
  ) {
    return { ok: false, reason: "rule_bymonthday" };
  }
  for (const day of byMonthDay)
    if (typeof day !== "number" || !Number.isInteger(day) || day < 1 || day > 31)
      return { ok: false, reason: "rule_bymonthday" };

  const count = source.count ?? null;
  if (
    count !== null &&
    (typeof count !== "number" ||
      !Number.isInteger(count) ||
      count < 1 ||
      count > MAX_RECURRENCE_COUNT)
  ) {
    return { ok: false, reason: "rule_bound" };
  }
  const untilRaw = source.until ?? null;
  const until = untilRaw === null ? null : parseWall(untilRaw);
  if (untilRaw !== null && until === null) return { ok: false, reason: "rule_bound" };
  // RFC 5544 allows both bounds and takes the earlier; that is a second rule for
  // the same column, so the repository rejects the combination instead.
  if (count !== null && until !== null) return { ok: false, reason: "rule_bound" };

  const exdates = source.exdates ?? [];
  if (!Array.isArray(exdates) || exdates.length > MAX_RECURRENCE_EXDATES)
    return { ok: false, reason: "rule_exdate" };
  {
    let previous = -Infinity;
    for (const raw of exdates) {
      if (typeof raw !== "string") return { ok: false, reason: "rule_exdate" };
      const wall = parseWall(raw);
      // Canonical wall text only, strictly ascending: a duplicate or a reordering
      // means the column was not written by `ruleText`.
      if (wall === null || wall.text !== raw || wall.ms <= previous)
        return { ok: false, reason: "rule_exdate" };
      previous = wall.ms;
    }
  }

  return {
    ok: true,
    rule: {
      freq: source.freq as RecurrenceFrequency,
      interval,
      byDay: [...byDay] as string[],
      byMonth: [...byMonth] as number[],
      byMonthDay: [...byMonthDay] as number[],
      count,
      until,
      exdates: [...exdates],
    },
  };
}

/** Canonical `RRULE` text for a validated rule — what `event_recurrence.rule` stores. */
export function ruleText(rule: SeriesRule): string {
  const parts = [`FREQ=${rule.freq}`];
  if (rule.interval !== 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.byDay.length > 0) parts.push(`BYDAY=${rule.byDay.join(",")}`);
  if (rule.byMonth.length > 0) parts.push(`BYMONTH=${rule.byMonth.join(",")}`);
  if (rule.byMonthDay.length > 0) parts.push(`BYMONTHDAY=${rule.byMonthDay.join(",")}`);
  if (rule.count !== null) parts.push(`COUNT=${rule.count}`);
  if (rule.exdates.length > 0) {
    parts.push(`EXDATE=${rule.exdates.map((wall) => wall.replace(/[-:]/g, "")).join(",")}`);
  }
  if (rule.until !== null) parts.push(`UNTIL=${rule.until.text.replace(/[-:]/g, "")}`);
  return parts.join(";");
}

/**
 * Reads back the stored form. Rather than a second grammar, this converts the
 * `RRULE` text into the property object and then requires
 * `ruleText(validateRule(x).rule) === text`: the column may only ever contain the
 * canonical spelling, so a hand-edited row with a stray property fails here instead
 * of expanding differently than the writer intended.
 */
export function parseRuleText(
  value: unknown,
): { ok: true; rule: SeriesRule } | { ok: false; reason: RuleRejection } {
  if (typeof value !== "string") return { ok: false, reason: "rule_shape" };
  const properties = value.trim().split(";");
  const head = /^FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)$/.exec(properties[0] ?? "");
  if (!head || properties.length > 8) return { ok: false, reason: "rule_shape" };
  const source: Record<string, unknown> = { freq: head[1] };
  for (const property of properties.slice(1)) {
    const eq = property.indexOf("=");
    if (eq < 0) return { ok: false, reason: "rule_shape" };
    const key = property.slice(0, eq);
    const raw = property.slice(eq + 1);
    switch (key) {
      case "INTERVAL":
      case "COUNT":
        // Canonical decimal only: `COUNT=05` parses to 5 in JavaScript and in
        // rrule, but a column holding it was not written by `ruleText`.
        source[key.toLowerCase()] = /^(?:0|[1-9]\d*)$/.test(raw) ? Number(raw) : Number.NaN;
        break;
      case "BYDAY":
        source.byDay = raw.split(",");
        break;
      case "BYMONTH":
      case "BYMONTHDAY": {
        const numbers = raw.split(",").map((part) => Number(part));
        source[key.toLowerCase()] = numbers;
        break;
      }
      case "UNTIL": {
        // `UNTIL=20261204T235959` (RFC basic form, no designator: a series bound is
        // a wall clock, not an instant).
        const basic = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(raw);
        if (!basic) return { ok: false, reason: "rule_bound" };
        source.until = `${basic[1]}-${basic[2]}-${basic[3]}T${basic[4]}:${basic[5]}:${basic[6] ?? "00"}`;
        break;
      }
      case "EXDATE": {
        // Wall clocks in the series' zone, comma-separated, no designator — same
        // rule as `UNTIL`: a stored recurrence value is never an instant.
        const walls = raw.split(",").map((part) => {
          const basic = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(part);
          return basic
            ? `${basic[1]}-${basic[2]}-${basic[3]}T${basic[4]}:${basic[5]}:${basic[6] ?? "00"}`
            : null;
        });
        if (walls.some((wall) => wall === null)) return { ok: false, reason: "rule_exdate" };
        source.exdates = walls as string[];
        break;
      }
      default:
        return { ok: false, reason: "rule_shape" };
    }
  }
  const validated = validateRule(source);
  if (!validated.ok) return validated;
  if (ruleText(validated.rule) !== value.trim()) return { ok: false, reason: "rule_shape" };
  return validated;
}

export interface Occurrence {
  /** UTC instant, `Date.toISOString()` form — what `event_occurrences` stores. */
  startAt: string;
  endAt: string;
  /** Wall clock in the event's zone, `YYYY-MM-DDTHH:MM:SS` — what a human reads.
   * This is the wall clock of the *resolved* instants, so an occurrence that
   * landed in a spring-forward gap reports the shifted-forward time, not the
   * requested one. */
  wallStart: string;
  wallEnd: string;
  /** How far the wall clock had to be shifted to exist; 0 when it exists as-is. */
  shiftedMs: number;
}

export interface Expansion {
  status: RecurrenceStatus;
  occurrences: Occurrence[];
  /** Set when `status` is `"invalid"`: why the series cannot be expanded. */
  reason?: string;
  /** Set when `status` is `"truncated"`: occurrences the cap cut off. */
  dropped?: number;
}

/**
 * Expands one series inside an instant window.
 *
 * The sandwich is the whole design: the window is converted to wall clocks, `rrule`
 * walks the wall calendar, and every wall stamp is resolved through the event's
 * zone. That is why a daily series across Asia/Jerusalem's 2026-03-27 transition
 * keeps `09:00` on every day (the instants drift by an hour) instead of keeping the
 * instants 24h apart and letting the local time drift.
 *
 * Duration is added in wall space too, so an all-day event starts and ends on the
 * same local clock times it would have without a transition. The *instant* span
 * can still change — a 24h event on the Jerusalem transition day is stored as 23h
 * — which is what `README.md` §6 means by "a timed event keeps its local clock
 * time across a DST transition".
 */
export function expandSeries(input: {
  anchor: WallClock;
  durationMs: number;
  zone: string;
  rule: SeriesRule;
  windowStart: number;
  windowEnd: number;
  cap?: number;
}): Expansion {
  const cap = input.cap ?? MAX_SERIES_OCCURRENCES;
  const offsets = zoneOffsetsInWindow(input.zone, input.windowStart, input.windowEnd);
  if (offsets === null) return { status: "invalid", reason: "zone_unavailable", occurrences: [] };
  if (input.windowEnd <= input.windowStart) return { status: "ok", occurrences: [] };

  // Window bounds as wall clocks, so `rrule` never sees an instant.
  const windowStartWall = parseWall(wallTextOf(input.windowStart, input.zone) ?? "");
  const windowEndWall = parseWall(wallTextOf(input.windowEnd, input.zone) ?? "");
  if (!windowStartWall || !windowEndWall)
    return { status: "invalid", reason: "zone_unavailable", occurrences: [] };

  if (input.rule.until !== null && input.rule.until.ms <= input.anchor.ms) {
    return { status: "invalid", reason: "rule_until_before_anchor", occurrences: [] };
  }
  // Measured: `rrulestr` re-anchors its UTC-field dates onto the *system* zone —
  // under TZ=UTC+2 a `UNTIL=20260328T090000` string comes back as 07:00 — whereas
  // the constructor reads every date as UTC fields whatever the system zone is.
  // The stored value is a wall clock by definition, so the rule is built from the
  // validated parts rather than from its text.
  const options: Partial<Options> = {
    freq: FREQ_BY_NAME[input.rule.freq],
    interval: input.rule.interval,
    dtstart: new Date(input.anchor.ms),
  };
  if (input.rule.byDay.length > 0) {
    // WEEKDAY_BY_NAME is an open Record, so the lookup is narrowed before it reaches
    // rrule's byweekday; every name here has already passed validateRule.
    const weekdays = input.rule.byDay
      .map((day) => WEEKDAY_BY_NAME[day])
      .filter((weekday) => weekday !== undefined);
    options.byweekday = weekdays;
  }
  if (input.rule.byMonth.length > 0) options.bymonth = [...input.rule.byMonth];
  if (input.rule.byMonthDay.length > 0) options.bymonthday = [...input.rule.byMonthDay];
  if (input.rule.count !== null) options.count = input.rule.count;
  if (input.rule.until !== null) options.until = new Date(input.rule.until.ms);

  let rule: RRule;
  try {
    // No cache: a server expands a different rule per request.
    rule = new RRule(options, true);
  } catch {
    return { status: "invalid", reason: "rule_unexpandable", occurrences: [] };
  }

  // `between` is exclusive at both ends (measured), hence the 1ms shift on the
  // lower bound; the upper bound stays exclusive because that is what the agenda
  // window means.
  const walls = rule.between(new Date(windowStartWall.ms - 1), new Date(windowEndWall.ms));
  const exdates = new Set(input.rule.exdates.map((wall) => parseWall(wall)?.ms ?? Number.NaN));
  const occurrences: Occurrence[] = [];
  const seen = new Set<string>();
  for (const wallDate of walls) {
    // `rrule` returns Dates whose UTC fields are the wall clock, so `getTime()`
    // *is* the wall stamp; see the module header.
    const wallMs = wallDate.getTime();
    // `EXDATE` cancels in wall space, against the stamp the series *asked* for:
    // an occurrence cancelled on a date that also happens to sit in a spring-forward
    // gap is still cancelled, even though its resolved stamp would read differently.
    if (exdates.has(wallMs)) continue;
    const start = instantiateWallWith(wallMs, input.zone, offsets);
    if (!start) return { status: "invalid", reason: "zone_unavailable", occurrences: [] };
    const end = instantiateWallWith(wallMs + input.durationMs, input.zone, offsets);
    if (!end) return { status: "invalid", reason: "zone_unavailable", occurrences: [] };
    // The window is applied in wall space above; this re-checks the same bound in
    // instant space so no caller can be handed an occurrence outside the window it
    // asked for (an ambiguous lower bound could otherwise resolve to the earlier of
    // the two instants sharing that wall clock).
    if (start.instant < input.windowStart || start.instant >= input.windowEnd) continue;
    const startAt = new Date(start.instant).toISOString();
    const endAt = new Date(end.instant).toISOString();
    const key = `${startAt}|${endAt}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const wallStart = wallTextOf(start.instant, input.zone);
    const wallEnd = wallTextOf(end.instant, input.zone);
    if (wallStart === null || wallEnd === null)
      return { status: "invalid", reason: "zone_unavailable", occurrences: [] };
    occurrences.push({
      startAt,
      endAt,
      wallStart,
      wallEnd,
      shiftedMs: Math.max(
        start.kind === "gap" ? start.shiftedByMs : 0,
        end.kind === "gap" ? end.shiftedByMs : 0,
      ),
    });
  }

  if (occurrences.length > cap) {
    return {
      status: "truncated",
      occurrences: occurrences.slice(0, cap),
      dropped: occurrences.length - cap,
    };
  }
  return { status: "ok", occurrences };
}

/** The single occurrence of a non-recurring event, in the same shape. */
export function singleOccurrence(startAt: string, endAt: string, zone: string): Occurrence | null {
  const start = Date.parse(startAt);
  const end = Date.parse(endAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const wallStart = wallTextOf(start, zone);
  const wallEnd = wallTextOf(end, zone);
  if (!wallStart || !wallEnd) return null;
  return {
    startAt: new Date(start).toISOString(),
    endAt: new Date(end).toISOString(),
    wallStart,
    wallEnd,
    shiftedMs: 0,
  };
}
