# ADR-0002 — Recurrence: store a rule and a zone, expand in wall-clock space

Status: **accepted** (packet 2E, 2026-11-25). Closes the open row in
`docs/ARCHITECTURE.md` §142 ("rrule expansion + exception model details → `docs/adr/0002`").
Referenced from `src/lib/recurrence.ts` and `tests/unit/recurrenceEngine.test.ts`; consumed by
packet 2F (`event_recurrence_rules`, `event_occurrence_exceptions`), packet 2G (edit/delete modes)
and packet 2.5 (`.ics` export).

## Context

`README.md` §6 requires a recurring event to support daily, weekly, monthly, yearly and custom
interval with DST, month-end and leap-year correctness, plus exceptions; `docs/PLAN.md` §6 2.3
requires expansion to be "bounded or capped"; `docs/ARCHITECTURE.md` §3 stores every timestamp as
UTC ISO-8601 TEXT and applies the user's IANA zone only at rendering and scheduling boundaries.

The decision has to be written down **before** 2F creates a table, because it fixes four things a
schema cannot express later: what bytes the rule column may contain, what identifies an occurrence,
whether a query window includes its endpoints, and what happens to a local time that does not exist
(spring-forward gap) or exists twice (fall-back overlap).

## Measured against the installed `rrule` 2.8.1

Node's own IANA database via `Intl`; no Temporal or tz library is installed. Each row below was
probed, not read.

| Probe                                                         | Measured outcome                                                          | Consequence                                                                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `rrulestr("RRULE:FREQ=HOURLY;COUNT=3")`                       | parses and expands hourly                                                 | `rrulestr` is a lenient parser, not a validator — `validateRule` is the gate                                                         |
| `rrulestr("…;COUNT=3;BYSETPOS=-1")`                           | parses without complaint                                                  | unknown properties must be rejected **here**, or they serialize into `.ics` and mean something else in a calendar app                |
| `rrulestr("RRULE:FREQ=DAILY;COUNT=3;EXDATE=20260102T090000")` | `Error: Unknown RRULE property 'EXDATE'`                                  | exceptions cannot live inside the RRULE value `rrule` itself reads; they are engine/repository data, keyed as wall clocks            |
| constructor with `dtstart`/`until` as `Date.UTC(...)` values  | identical UTC fields under `TZ=UTC` and `TZ=Asia/Jerusalem`               | wall stamps travel as `Date.UTC(...)` values; a rule is rebuilt from validated parts, never re-parsed from its text                  |
| `MONTHLY` + `BYMONTHDAY=31` from `2026-01-31`, `COUNT=4`      | `2026-01-31, 03-31, 05-31, 07-31`                                         | February is **skipped**, not clamped to Feb 28 — matches RFC 5544's skip-invalid-dates rule                                          |
| `YEARLY` from `2000-02-29`, `COUNT=3`                         | `2000-02-29, 2004-02-29, 2008-02-29`                                      | a leap-day anchor emits nothing at all for a non-leap year (pinned at `recurrenceEngine.test.ts:123`)                                |
| `rule.between(a, b)`                                          | exclusive at **both** ends                                                | a window is passed as `(from - 1ms, to)` (pinned at `:137`)                                                                          |
| `Intl.DateTimeFormat(…, timeZoneName: "longOffset")`          | `GMT+02:00` / `GMT+03:00` / `GMT`; an invalid IANA id throws `RangeError` | offset probing is the resolver; a bad zone becomes a cached negative entry, so the series is `invalid` rather than the agenda 500ing |

## Decision

1. **Canonical storage.** 2F's `event_recurrence_rules` row holds: `rule` TEXT — the canonical
   text `ruleText()` produces; `timezone` TEXT — an IANA id; and the anchor as a wall clock
   (`events.date` + `events.time`). A stored recurrence value never carries an offset or `Z`: a
   rule that named an absolute instant could not be re-expanded in a different zone, which is the
   whole point of storing the zone separately. The column grammar is `FREQ` first, then optional
   `INTERVAL`, `BYDAY`, `BYMONTH`, `BYMONTHDAY`, `COUNT`, `EXDATE`, `UNTIL` in that fixed order,
   canonical digits only (`COUNT=05` is rejected), and `parseRuleText` requires
   `ruleText(validateRule(x).rule) === text` — a hand-edited row fails closed instead of
   expanding differently than the writer intended. `EXDATE` inside the value is **our extension**
   (measured: `rrule` rejects it); the `.ics` writer in 2.5 must emit top-level `EXDATE:` properties
   instead of reusing this column form.
2. **Occurrence key.** The identity of an occurrence is the pair of instants
   `(startAt, endAt)` in `YYYY-MM-DDTHH:MM:SS.000Z` form, scoped to its series row — the engine
   dedupes on exactly `startAt|endAt`. Wall stamps are derived output, never keys: across a fall-back
   overlap two instants share one stamp, so a wall-based key would collide. `event_occurrence_exceptions`
   keys on the **wall stamp**, because an exception means "the occurrence this series asked for on
   this local date", which is what a user actually clicks.
3. **Inclusivity.** A query window is `[windowStart, windowEnd)` in instants, and the bound is
   re-checked _after_ zone resolution so no caller is handed an occurrence outside the window it
   asked for (an ambiguous lower bound would otherwise resolve to the earlier of two instants).
   `UNTIL` is **inclusive** and is a wall clock in the series zone. `COUNT` counts from the anchor,
   not from the window — a window that starts mid-series does not renumber a bounded series.
4. **Timezone/DST.** `rrule` walks the wall calendar; every wall stamp is then resolved through the
   event's zone. A wall clock that exists once → that instant. A fall-back overlap → the **earlier**
   instant (so 02:30 on 2026-10-25 in `Asia/Jerusalem` is the +03:00 one). A spring-forward gap → the
   **first instant whose wall clock is past the requested stamp** (RFC 5544 `gap_start`), located by
   bisecting the monotone wall predicate; the occurrence shifts forward, it never vanishes. Duration is
   added in wall space, so an all-day event is 24h in wall space and 23h in instants on the Jerusalem
   transition day. `wallStart` reports the **resolved** clock, and `shiftedMs` records the shift, so a
   gap occurrence is visible rather than silently renamed.
5. **`COUNT` / `UNTIL`.** At most one bound; both together is rejected (`rule_bound`) rather than
   resolved to the earlier — RFC 5544 allows the combination, and a second rule for the same column is
   not worth the ambiguity. `COUNT ≤ 730`; `UNTIL` must be strictly after the anchor.
6. **Bounded expansion.** `MAX_SERIES_OCCURRENCES = 730` (two years of the densest legal series),
   `MAX_RECURRENCE_INTERVAL = 1000`, `MAX_RECURRENCE_EXDATES = 100`. Expansion returns
   `status: "ok" | "invalid" | "truncated"` plus a `dropped` count: truncation is **reported**, never
   silent, and 2F must surface it rather than persist a partial series.
7. **Admissible subset, validated before `rrule` runs.** `DAILY`, `WEEKLY`, `MONTHLY`, `YEARLY` only;
   no `HOURLY`/`MINUTELY`/`SECONDLY`, no `BYSETPOS`, `WKST`, `RDATE`, `TZID`. A `SECONDLY` rule would
   otherwise silently hit the cap instead of failing the request.
8. **Purity.** No database access, no Next APIs, no module state beyond the zone-formatter cache.
   Persistence is 2F's job; this module is what makes 2F a thin writer.

## Rejected

- **Materializing every occurrence row at save time** — unbounded for an open-ended series; 2F stores
  the rule plus exceptions and expands per query window.
- **Storing instants** (UTC `dtstart` + `INTERVAL=1` day) — the local clock drifts an hour across a
  DST Sunday, which is exactly the failure `README.md` §6 names.
- **`rrulestr` as validator or reader of the column** — measured lenient, and it cannot read our
  `EXDATE`.
- **`rrule`'s `tzid` support and `RRuleSet.exdate(instant)`** — the zone is a column per
  `ARCHITECTURE.md` §3, and exceptions are wall stamps, not instants.
- **Clamping month-end** (`BYMONTHDAY=31` → Feb 28) — measured behaviour is to skip; clamping would
  invent an occurrence the user never asked for.
- **A Temporal or tz library** — not installed; offset probing is bounded to ≤ 400 `Intl` probes per
  window and pinned by the unit matrix.

## Still open (deliberately)

- 2F owns the tables and the "expand only inside a required query window" API; 2G owns this-and-future
  truncation and how existing exceptions transfer to the new series; 2.5 owns `VTIMEZONE` generation.
- Offset probing assumes transitions are ≥ 6h apart inside a window (`step = max(6h, span/400)`); true
  for every zone in the matrix, unproven for a pathological one.
- Whether a truncated series is a `4xx` or a warning at the HTTP boundary — decided in 2F.
