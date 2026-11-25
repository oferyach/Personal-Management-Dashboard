/**
 * Event tables (packet 2B): `events` and `event_participants`.
 *
 * Deliberately *not* here: `event_recurrence_rules` and `event_exceptions`.
 * Packet 2C adds the non-recurring service and API, and the recurrence engine is
 * its own packet (2.3 in `docs/PLAN.md`), so a recurrence table written now would
 * be a schema guess about expansion semantics that have not been decided yet.
 * `events.id` is stable instead: a recurrence series can only ever point at a
 * row that already exists.
 *
 * Traceability: `README.md` §6 ("Each event should support: … Owner … Optional
 * participants"), `docs/PLAN.md` §6 (2.1 `events`, `event_participants`; 2.2
 * "timezone-correct serialization (user TZ rendering, UTC storage), all-day
 * handling; color/category/status; participants (authorized users only)"),
 * `docs/ARCHITECTURE.md` §2 ("Ownership is a column on every user-owned table
 * (`owner_user_id`) and is always part of the query predicate"), §3 ("All
 * timestamps stored UTC in ISO-8601 `TEXT`"; "Indexes declared explicitly with
 * the query patterns they serve").
 */
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { users } from "./auth";

/**
 * One row per event. `start_at`/`end_at` are stored as UTC instants with a
 * trailing `Z`; the user's IANA zone lives in `timezone` and is applied only at
 * rendering and scheduling boundaries (`docs/ARCHITECTURE.md` §3). The CHECK
 * constraints below are the last line of defence: `src/lib/events.ts` validates
 * first, but a hand-written row or a future service that skips validation still
 * cannot put a local-time string or an inverted range in this table.
 */
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description"),
    startAt: text("start_at").notNull(),
    endAt: text("end_at").notNull(),
    // Mirrors `user_preferences.timezone`'s default, but stored per event: an
    // event created while the user was set to Asia/Jerusalem keeps that zone after
    // they switch to Europe/London, which is what a rescheduled trip needs.
    timezone: text("timezone").notNull().default("Asia/Jerusalem"),
    isAllDay: integer("is_all_day", { mode: "boolean" }).notNull().default(false),
    // iCalendar STATUS vocabulary (RFC 5544/5545 `TENTATIVE|CONFIRMED|CANCELLED`),
    // chosen now because 2.5 has to serialize this column into `.ics` without a
    // later migration rewriting the CHECK.
    status: text("status").notNull().default("tentative"),
    category: text("category"),
    color: text("color"),
    location: text("location"),
    createdAt: text("created_at").notNull(),
    // Optimistic concurrency token: `src/lib/events.ts::updateEvent` compares the
    // caller's expected value against this column inside the write transaction,
    // so two tabs editing one event cannot silently overwrite each other.
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    // The agenda/list view is "my events in this window, oldest first, paginated
    // by (start_at, id)"; the id tiebreaker keeps two events starting in the same
    // second from being skipped or repeated at a page boundary.
    index("events_owner_start_idx").on(table.ownerUserId, table.startAt, table.id),
    index("events_owner_status_start_idx").on(table.ownerUserId, table.status, table.startAt),
    // Dashboard aggregates ("events by category/status in a range") run across
    // owners for privileged actors, so status leads here.
    index("events_status_start_idx").on(table.status, table.startAt),
    // `glob` is case-sensitive and anchored, so this is a real UTC shape check:
    // four digits, month, day, `T`, clock, then `Z`. `*` is only there to allow
    // fractional seconds, so the length bound keeps it from also accepting
    // `2026-11-25T09:00:00nonsenseZ`. A `2026-11-25T09:00:00` local-time string
    // fails it, which is the point — the repository's whole timezone promise
    // depends on stored instants being unambiguous.
    check(
      "events_start_utc_chk",
      sql`"start_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z' and length("start_at") between 21 and 32`,
    ),
    check(
      "events_end_utc_chk",
      sql`"end_at" glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9]*Z' and length("end_at") between 21 and 32`,
    ),
    // `end_at` is exclusive for both kinds of event, so the range test is one
    // comparison and an all-day event that ends on the day it starts still has a
    // non-empty span (midnight → next midnight). Text order equals instant order
    // only for one canonical form, which is what `src/lib/events.ts` writes: every
    // stored value comes from `Date.toISOString()` and therefore always carries
    // three fractional digits, so `events_owner_start_idx` sorts correctly.
    check("events_time_chk", sql`"end_at" > "start_at"`),
    check(
      "events_all_day_bounds_chk",
      sql`"is_all_day" = 0 OR (substr("start_at", 12, 8) = '00:00:00' AND substr("end_at", 12, 8) = '00:00:00')`,
    ),
    check("events_status_chk", sql`"status" in ('tentative', 'confirmed', 'cancelled')`),
    check("events_all_day_chk", sql`"is_all_day" in (0, 1)`),
    check("events_title_chk", sql`length("title") between 1 and 300`),
    check("events_description_chk", sql`"description" is null or length("description") <= 5000`),
    check("events_category_chk", sql`"category" is null or length("category") between 1 and 60`),
    check("events_location_chk", sql`"location" is null or length("location") <= 300`),
    check(
      "events_color_chk",
      sql`"color" is null or "color" glob '#[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]'`,
    ),
    check("events_timezone_chk", sql`length("timezone") between 1 and 64`),
  ],
);

/**
 * Who is invited to an event, besides its owner. The owner is never stored here:
 * they are implicitly an attendee and cannot be removed, so "attendees of event X"
 * is this table plus `events.owner_user_id`, and a participant row can never
 * contradict the owner column.
 *
 * `added_by` records who invited them (an administrator can add a participant to
 * someone else's event), kept separate from `user_id` for exactly that reason.
 */
export const event_participants = sqliteTable(
  "event_participants",
  {
    id: text("id").primaryKey(),
    eventId: text("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
  },
  (table) => [
    // The database decides "invited once": two concurrent invites of the same
    // person collapse into one row rather than a duplicate attendee list.
    uniqueIndex("event_participants_unique_participant").on(table.eventId, table.userId),
    // "Which events am I invited to" — the participant-scoped read in
    // `src/lib/events.ts` — starts from the user id.
    index("event_participants_user_idx").on(table.userId, table.eventId),
    index("event_participants_event_idx").on(table.eventId, table.userId),
  ],
);
