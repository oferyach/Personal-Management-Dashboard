/**
 * Event repository (packet 2B) — the only module that touches `events` and
 * `event_participants`.
 *
 * Two rules decide everything here:
 *
 * 1. **The actor is part of the query.** `docs/ARCHITECTURE.md` §2: ownership
 *    "is always part of the query predicate, so an unguessable/other-user ID
 *    yields 404 (no existence leak)". `eventView` turns the actor's `calendar.*`
 *    grants into one predicate before SQL is built; `readEvent` answers
 *    `not_found` for a row that exists but is invisible — the same answer as for a
 *    row that does not exist.
 * 2. **Stored instants are UTC, canonical, and comparable.** Every value written
 *    comes from `Date.toISOString()`, so text order equals instant order and the
 *    `(owner_user_id, start_at, id)` index serves the agenda query directly.
 *
 * Not in this packet: recurrence (`event_recurrence_rules`, exceptions,
 * occurrence identity) and any UI or route — 2C adds the service and
 * `/api/v1/events`, 2.3 adds the recurrence engine.
 *
 * Traceability: `README.md` §6 (event properties: start/end, all-day flag,
 * timezone, location, category, color, status, owner, participants, creation and
 * modification timestamps), `docs/PLAN.md` §6 (2.1, 2.2), `docs/ARCHITECTURE.md`
 * §§2–3.
 */
import { randomUUID } from "crypto";

import { and, asc, eq, gt, gte, isNull, lt, or, sql, SQL } from "drizzle-orm";
import { getDb } from "@/db/client";
import { tag_links, type EventRow, event_participants, events, tags, users } from "@/db/schema";
import {
  EVENT_COLOR_PATTERN,
  EVENT_STATUSES,
  MAX_EVENT_CATEGORY_LENGTH,
  MAX_EVENT_DESCRIPTION_LENGTH,
  MAX_EVENT_LOCATION_LENGTH,
  MAX_EVENT_TITLE_LENGTH,
  MAX_PAGE_SIZE,
  MAX_QUERY_WINDOW_DAYS,
  MAX_SEARCH_QUERY_LENGTH,
  ProductivityError,
  type ProductivityErrorReason,
  clampPageSize,
  isEventStatus,
  isUniqueConstraintError,
  requireResourceId,
  type EventStatus,
} from "./productivity";
import { authorize, can, type Actor } from "./rbac";
import { readPreferences } from "./preferences";
import { recordActivity } from "./activity";
import { attachTag, detachTag, tagView, type TagLinkSummary } from "./tags";

/**
 * Date-only shape (`2026-11-25`). Accepted only for all-day events, where the
 * user picked calendar days rather than instants — the same distinction iCalendar
 * draws between `VALUE=DATE` and `VALUE=DATE-TIME`.
 */
const DATE_SHAPE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Instant shape, and a `Z` or explicit offset is *required*: a bare
 * `2026-11-25T09:00` would be parsed as local time, which is precisely the bug
 * `events_start_utc_chk` exists to make impossible.
 */
const INSTANT_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})$/;

const DAY_MS = 86_400_000;

/**
 * One bounded text field, shared by title/description/category/location.
 * Control characters are rejected rather than stripped: an invisible title is
 * unfindable in a list and can smuggle a newline into a rendered label. NFC plus
 * whitespace collapsing keeps a composed Hebrew title from becoming two different
 * strings for search (2S).
 */
interface TextFieldSpec {
  label: string;
  max: number;
  invalid: ProductivityErrorReason;
  tooLong: ProductivityErrorReason;
}

function boundedText(value: unknown, spec: TextFieldSpec): string {
  if (typeof value !== "string") {
    throw new ProductivityError(spec.invalid, `${spec.label} must be a string.`);
  }
  if (/[\u0000-\u001F\u007F\u0080-\u009F]/.test(value)) {
    throw new ProductivityError(spec.invalid, `${spec.label} may not contain control characters.`);
  }
  const trimmed = value.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (trimmed.length === 0) {
    throw new ProductivityError(spec.invalid, `${spec.label} must not be empty.`);
  }
  if (trimmed.length > spec.max) {
    throw new ProductivityError(
      spec.tooLong,
      `${spec.label} must be at most ${spec.max} characters.`,
    );
  }
  return trimmed;
}

const titleOf = (value: unknown): string =>
  boundedText(value, {
    label: "Title",
    max: MAX_EVENT_TITLE_LENGTH,
    invalid: "invalid_title",
    tooLong: "title_too_long",
  });

/** Optional field: null, undefined and "" all mean "no value", never an empty string. */
function optionalText(value: unknown, spec: TextFieldSpec): string | null {
  if (value === null || value === undefined || value === "") return null;
  return boundedText(value, spec);
}

const descriptionOf = (value: unknown): string | null =>
  optionalText(value, {
    label: "Description",
    max: MAX_EVENT_DESCRIPTION_LENGTH,
    invalid: "invalid_description",
    tooLong: "description_too_long",
  });

const categoryOf = (value: unknown): string | null =>
  optionalText(value, {
    label: "Category",
    max: MAX_EVENT_CATEGORY_LENGTH,
    invalid: "invalid_category",
    tooLong: "category_too_long",
  });

const locationOf = (value: unknown): string | null =>
  optionalText(value, {
    label: "Location",
    max: MAX_EVENT_LOCATION_LENGTH,
    invalid: "invalid_location",
    tooLong: "location_too_long",
  });

/**
 * A required IANA zone id (`Asia/Jerusalem`, `Europe/London`). Validated through
 * `Intl.DateTimeFormat`, which is the same zone database the browser will use to
 * render the event, so a zone the UI cannot render can never be stored. Stored
 * verbatim: it is a machine value, never translated.
 */
function requireTimezone(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 64) {
    throw new ProductivityError("invalid_timezone", "Timezone must be an IANA zone id.");
  }
  if (!/^[A-Za-z][A-Za-z_]*(\/[A-Za-z0-9_+-]+)*$/.test(value)) {
    throw new ProductivityError("invalid_timezone", "Timezone must be an IANA zone id.");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(new Date());
  } catch {
    throw new ProductivityError("invalid_timezone", `Unknown timezone: ${value}.`);
  }
  return value;
}

/** One of the `events_status_chk` values. Machine value: never translated. */
function requireStatus(value: unknown): EventStatus {
  if (!isEventStatus(value)) {
    throw new ProductivityError(
      "invalid_status",
      `Status must be one of: ${EVENT_STATUSES.join(", ")}.`,
    );
  }
  return value;
}

/** `#rrggbb`, the only form the calendar UI, CSS and `.ics` export accept. */
function requireColor(value: unknown): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !EVENT_COLOR_PATTERN.test(value)) {
    throw new ProductivityError("invalid_color", "Color must be a #rrggbb hex value.");
  }
  return value.toLowerCase();
}

/**
 * Canonical UTC instant from a user-supplied string: `2026-11-25T09:00+02:00` and
 * `2026-11-25T07:00Z` become the same stored row. This is the "UTC round-trip"
 * guarantee — the value that comes back out is the instant that went in, whatever
 * offset the caller used.
 */
function requireInstant(value: unknown, label: string): number {
  if (typeof value !== "string" || !INSTANT_SHAPE.test(value)) {
    throw new ProductivityError("invalid_instant", `${label} must be an ISO-8601 instant.`);
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new ProductivityError("invalid_instant", `${label} is not a real date and time.`);
  }
  return parsed;
}

/**
 * A calendar day for an all-day event. `Date.parse` rejects impossible days
 * (`2026-02-30`), so the shape test plus this parse is the whole validation.
 */
function requireDay(value: unknown, label: string): number {
  if (typeof value !== "string" || !DATE_SHAPE.test(value)) {
    throw new ProductivityError(
      "invalid_all_day",
      `${label} must be a calendar date (YYYY-MM-DD) for an all-day event.`,
    );
  }
  const parsed = Date.parse(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed)) {
    throw new ProductivityError("invalid_all_day", `${label} is not a real calendar date.`);
  }
  return parsed;
}

/**
 * Start and end normalized to the two forms the table allows, both stored as
 * canonical UTC instants so `events_owner_start_idx` sorts them correctly.
 *
 * All-day events carry calendar days, not instants, so they are the one place a
 * user's "end date" needs a rule: `end` is exclusive (iCalendar `DTEND`), which
 * means `2026-11-25 → 2026-11-26` is the 25th alone. Passing the same day twice,
 * or no end at all, is the common way to mean exactly that, so both normalize to
 * a one-day span instead of the inverted range the CHECK would reject.
 */
interface NormalizedTime {
  startAt: string;
  endAt: string;
  isAllDay: boolean;
}

function normalizeTimes(input: {
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
}): NormalizedTime {
  if (input.allDay !== undefined && input.allDay !== null && typeof input.allDay !== "boolean") {
    throw new ProductivityError("invalid_all_day", "The all-day flag must be a boolean.");
  }
  if (input.allDay === true) {
    const startDay = requireDay(input.start, "Start");
    if (input.end === undefined || input.end === null || input.end === "") {
      return {
        startAt: new Date(startDay).toISOString(),
        endAt: new Date(startDay + DAY_MS).toISOString(),
        isAllDay: true,
      };
    }
    const endDay = requireDay(input.end, "End");
    if (endDay < startDay) {
      throw new ProductivityError("inverted_range", "An event must end after it starts.");
    }
    // Same day twice means one day; a later end day is already exclusive.
    const endExclusive = endDay === startDay ? startDay + DAY_MS : endDay;
    return {
      startAt: new Date(startDay).toISOString(),
      endAt: new Date(endExclusive).toISOString(),
      isAllDay: true,
    };
  }

  const startAt = requireInstant(input.start, "Start");
  const endAt = requireInstant(input.end, "End");
  if (endAt <= startAt) {
    throw new ProductivityError("inverted_range", "An event must end after it starts.");
  }
  return {
    startAt: new Date(startAt).toISOString(),
    endAt: new Date(endAt).toISOString(),
    isAllDay: false,
  };
}

/**
 * How much of `events` one actor can see, resolved to a SQL predicate before any
 * query is built (same shape as `src/lib/activity.ts::activityView`).
 *
 * `calendar.view.any` is the administrative global view; `own` is the actor's
 * own events; `shared` adds events the actor is a participant in, which is the
 * only sharing relation this packet has (per-resource grants arrive with the
 * sharing UI). An actor holding none of the three is refused rather than shown
 * an empty list, so a missing permission is a 403 and not a silent 200.
 */
type EventView = { kind: "none" } | { kind: "all" } | { kind: "where"; predicate: SQL };

async function eventView(actor: Actor): Promise<EventView> {
  if (await can(actor, "calendar.view.any")) return { kind: "all" };
  const holdsOwn = await can(actor, "calendar.view.own");
  const holdsShared = await can(actor, "calendar.view.shared");
  if (!holdsOwn && !holdsShared) return { kind: "none" };

  const clauses: SQL[] = [];
  if (holdsOwn) clauses.push(eq(events.ownerUserId, actor.userId));
  if (holdsShared) {
    clauses.push(sql`exists (
      select 1 from ${event_participants}
      where ${event_participants.eventId} = ${events.id}
        and ${event_participants.userId} = ${actor.userId}
    )`);
  }
  const combined = or(...clauses);
  return { kind: "where", predicate: combined ?? clauses[0]! };
}

/** A row of `events` in the shape services and (later) routes return. */
export interface EventRecord {
  id: string;
  ownerUserId: string;
  title: string;
  description: string | null;
  startAt: string;
  endAt: string;
  timezone: string;
  isAllDay: boolean;
  status: EventStatus;
  category: string | null;
  color: string | null;
  location: string | null;
  createdAt: string;
  updatedAt: string;
}

function recordOf(row: EventRow): EventRecord {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    title: row.title,
    description: row.description,
    startAt: row.startAt,
    endAt: row.endAt,
    timezone: row.timezone,
    isAllDay: row.isAllDay,
    status: row.status as EventStatus,
    category: row.category,
    color: row.color,
    location: row.location,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export interface EventInput {
  actor: Actor;
  /** Administrator-only: create on another account's behalf (`calendar.edit.any`). */
  ownerUserId?: string;
  title: unknown;
  start: unknown;
  end: unknown;
  description?: unknown;
  timezone?: unknown;
  allDay?: unknown;
  status?: unknown;
  category?: unknown;
  color?: unknown;
  location?: unknown;
}

/**
 * Create one event owned by the actor.
 *
 * The timezone defaults to the *owner's* stored preference rather than a fixed
 * zone, because that is the zone the user reads the calendar in; an explicit
 * `timezone` overrides it. Everything else is validated before the insert, so
 * the CHECK constraints in `src/db/schema/events.ts` stay a backstop rather than
 * the primary error path.
 */
export async function createEvent(actor: Actor, input: EventInput): Promise<EventRecord> {
  return insertEvent(actor, input);
}

/**
 * Shared body of `createEvent` and `duplicateEvent`.
 *
 * `provenance` is the only difference between the two: a duplicate is a create
 * whose feed entry names the event it was copied from, which keeps "copied from…"
 * in the dashboard without a second table (§13: the feed is the audit trail).
 * The activity write is best-effort by design — `recordActivity` logs and returns
 * null rather than turning a committed event into a reported failure.
 */
async function insertEvent(
  actor: Actor,
  input: Omit<EventInput, "actor">,
  provenance?: { duplicatedFrom: string },
): Promise<EventRecord> {
  await authorize(actor, "calendar.create");

  const ownerUserId =
    input.ownerUserId === undefined || input.ownerUserId === null || input.ownerUserId === ""
      ? actor.userId
      : requireResourceId(input.ownerUserId);
  if (ownerUserId !== actor.userId) {
    if (!(await can(actor, "calendar.edit.any"))) {
      throw new ProductivityError(
        "not_authorized",
        "Creating an event for another account requires calendar.edit.any.",
      );
    }
    const [owner] = await getDb()
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, ownerUserId))
      .limit(1);
    if (owner === undefined) {
      throw new ProductivityError("not_found", "The owner account does not exist.");
    }
  }

  const time = normalizeTimes(input);
  const timezone =
    input.timezone === undefined || input.timezone === null || input.timezone === ""
      ? readPreferences(ownerUserId).timezone
      : requireTimezone(input.timezone);

  const now = new Date().toISOString();
  const record: EventRecord = {
    id: randomUUID(),
    ownerUserId,
    title: titleOf(input.title),
    description: descriptionOf(input.description),
    startAt: time.startAt,
    endAt: time.endAt,
    timezone,
    isAllDay: time.isAllDay,
    status:
      input.status === undefined || input.status === null
        ? "tentative"
        : requireStatus(input.status),
    category: categoryOf(input.category),
    color: requireColor(input.color),
    location: locationOf(input.location),
    createdAt: now,
    updatedAt: now,
  };

  await getDb().insert(events).values(record);
  await recordActivity({
    actor,
    ownerUserId: record.ownerUserId,
    resourceType: "event",
    resourceId: record.id,
    action: "created",
    detail: {
      title: record.title,
      ...(provenance === undefined ? {} : { duplicatedFrom: provenance.duplicatedFrom }),
    },
  });
  return record;
}

export interface EventUpdate {
  actor: Actor;
  eventId: unknown;
  /**
   * The `updatedAt` of the row the caller read. Required: an update without a
   * token cannot be checked, and two tabs editing one event would silently drop
   * one edit.
   */
  expectedUpdatedAt: unknown;
  title?: unknown;
  description?: unknown;
  start?: unknown;
  end?: unknown;
  allDay?: unknown;
  timezone?: unknown;
  status?: unknown;
  category?: unknown;
  color?: unknown;
  location?: unknown;
}

/**
 * Apply an optimistic-concurrency update.
 *
 * The expected token is part of the `UPDATE ... WHERE` rather than a prior read
 * comparison, so two concurrent writers cannot both "win": the second matches
 * zero rows and gets `version_conflict` (409). The new stamp is at least one
 * millisecond past the token, so a fast retry never produces an unchanged
 * `updatedAt` that would look like a conflict to the next caller.
 *
 * Time fields are re-normalized as a set: changing only `start` keeps the stored
 * `end`, and converting to or from all-day reuses the stored calendar days.
 */
export async function updateEvent(actor: Actor, input: EventUpdate): Promise<EventRecord> {
  const holdsAny = await can(actor, "calendar.edit.any");
  if (!holdsAny && !(await can(actor, "calendar.edit.own"))) {
    // Raise the real 403 instead of reporting a row as missing.
    await authorize(actor, "calendar.edit.own");
  }

  const eventId = requireResourceId(input.eventId);
  const expected = instantText(input.expectedUpdatedAt, "Expected updated_at");

  const view = await eventView(actor);
  if (view.kind === "none") {
    await authorize(actor, "calendar.view.own");
    throw new ProductivityError("not_authorized", "This actor cannot see any events.");
  }
  const [row] = await getDb()
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), view.kind === "where" ? view.predicate : undefined))
    .limit(1);
  if (row === undefined) {
    throw new ProductivityError("not_found", "No such event.");
  }
  if (row.ownerUserId !== actor.userId && !holdsAny) {
    throw new ProductivityError("not_authorized", "This event belongs to another account.");
  }

  let startAt = row.startAt;
  let endAt = row.endAt;
  let isAllDay = row.isAllDay;
  if (input.start !== undefined || input.end !== undefined || input.allDay !== undefined) {
    const allDay = input.allDay === undefined ? row.isAllDay : input.allDay === true;
    const time = normalizeTimes({
      start: input.start ?? (allDay ? row.startAt.slice(0, 10) : row.startAt),
      end: input.end ?? (allDay ? row.endAt.slice(0, 10) : row.endAt),
      allDay,
    });
    startAt = time.startAt;
    endAt = time.endAt;
    isAllDay = time.isAllDay;
  }

  const stamp = new Date(Math.max(Date.now(), Date.parse(expected) + 1)).toISOString();
  const [updated] = await getDb()
    .update(events)
    .set({
      title: input.title === undefined ? row.title : titleOf(input.title),
      description:
        input.description === undefined ? row.description : descriptionOf(input.description),
      startAt,
      endAt,
      isAllDay,
      timezone: input.timezone === undefined ? row.timezone : requireTimezone(input.timezone),
      status: input.status === undefined ? row.status : requireStatus(input.status),
      category: input.category === undefined ? row.category : categoryOf(input.category),
      color: input.color === undefined ? row.color : requireColor(input.color),
      location: input.location === undefined ? row.location : locationOf(input.location),
      updatedAt: stamp,
    })
    .where(and(eq(events.id, row.id), eq(events.updatedAt, expected)))
    .returning();
  if (updated === undefined) {
    throw new ProductivityError(
      "version_conflict",
      "This event changed since it was read; re-read it and retry.",
    );
  }

  const changedFields = [
    ["title", input.title],
    ["description", input.description],
    ["start", input.start],
    ["end", input.end],
    ["allDay", input.allDay],
    ["timezone", input.timezone],
    ["status", input.status],
    ["category", input.category],
    ["color", input.color],
    ["location", input.location],
  ]
    .filter(([, value]) => value !== undefined)
    .map(([name]) => name);
  await recordActivity({
    actor,
    ownerUserId: updated.ownerUserId,
    resourceType: "event",
    resourceId: updated.id,
    action: "updated",
    detail: { fields: changedFields },
  });
  return recordOf(updated);
}

export interface EventDelete {
  actor: Actor;
  eventId: unknown;
  /**
   * The `updatedAt` of the row the caller read. Optional here in a way it is not
   * for `updateEvent`: deleting is the one operation where a caller may legitimately
   * say "remove this, whatever happened in between". Supplied, the delete is
   * conditional on the token, so a UI holding a stale row cannot silently remove
   * an event someone else has since changed.
   */
  expectedUpdatedAt?: unknown;
}

/**
 * Delete an event and everything that hangs off it.
 *
 * `event_participants` goes with the `ON DELETE CASCADE` key. `tag_links` is
 * deliberately *not* cascaded — tags are shared vocabulary owned by the account,
 * not components of an event — so the links are removed explicitly, in the same
 * transaction as the event row, so no reader can observe an event with dangling
 * links or links pointing at a deleted event.
 *
 * Returns the row as it was before deletion, which is what a "deleted X, undo?"
 * affordance needs.
 */
export async function deleteEvent(actor: Actor, input: EventDelete): Promise<EventRecord> {
  const holdsAny = await can(actor, "calendar.edit.any");
  if (!holdsAny && !(await can(actor, "calendar.edit.own"))) {
    // Raise the real 403 instead of reporting a row as missing.
    await authorize(actor, "calendar.edit.own");
  }
  const eventId = requireResourceId(input.eventId);

  const view = await eventView(actor);
  if (view.kind === "none") {
    await authorize(actor, "calendar.view.own");
    throw new ProductivityError("not_authorized", "This actor cannot see any events.");
  }
  const [row] = await getDb()
    .select()
    .from(events)
    .where(and(eq(events.id, eventId), view.kind === "where" ? view.predicate : undefined))
    .limit(1);
  if (row === undefined) {
    throw new ProductivityError("not_found", "No such event.");
  }
  if (!holdsAny && row.ownerUserId !== actor.userId) {
    throw new ProductivityError("not_authorized", "This event belongs to another account.");
  }

  const expected =
    input.expectedUpdatedAt === undefined || input.expectedUpdatedAt === null
      ? null
      : instantText(input.expectedUpdatedAt, "Expected updatedAt");
  if (expected !== null && expected !== row.updatedAt) {
    throw new ProductivityError(
      "version_conflict",
      "This event changed since it was read; re-read it and retry.",
    );
  }

  const where: SQL[] = [eq(events.id, row.id)];
  if (expected !== null) where.push(eq(events.updatedAt, expected));
  const deleted = getDb().transaction((tx) => {
    tx.delete(tag_links)
      .where(and(eq(tag_links.resourceType, "event"), eq(tag_links.resourceId, row.id)))
      .run();
    return tx
      .delete(events)
      .where(and(...where))
      .returning()
      .get();
  });
  if (deleted === undefined) {
    // The token matched on the read above but not in the statement: someone
    // changed (or deleted) the row in between.
    throw new ProductivityError(
      "version_conflict",
      "This event changed since it was read; re-read it and retry.",
    );
  }

  await recordActivity({
    actor,
    ownerUserId: deleted.ownerUserId,
    resourceType: "event",
    resourceId: deleted.id,
    action: "deleted",
    detail: { title: deleted.title },
  });
  return recordOf(deleted);
}

/**
 * Copy an event the caller can see into a new event they own.
 *
 * This is a read plus a create, not an edit: the copy belongs to the actor, so
 * duplicating another account's visible event writes nothing under that account
 * and reveals nothing the actor could not already see. That is why it needs
 * `calendar.create` and no edit grant. Participants, tags and (later) recurrence
 * rules are *not* copied — an invitation is another account's decision, and a
 * rule set is a separate object with its own identity (§14).
 */
export async function duplicateEvent(actor: Actor, eventId: unknown): Promise<EventRecord> {
  await authorize(actor, "calendar.create");
  const source = await readEvent(actor, eventId);
  return insertEvent(
    actor,
    {
      title: source.title,
      description: source.description,
      start: source.startAt,
      end: source.endAt,
      allDay: source.isAllDay,
      timezone: source.timezone,
      status: source.status,
      category: source.category,
      color: source.color,
      location: source.location,
    },
    { duplicatedFrom: source.id },
  );
}

/**
 * Read one event by id.
 *
 * The id is never looked up unscoped: the actor's view predicate is part of the
 * `WHERE`, so a guessed id belonging to someone else returns exactly the same
 * answer as a nonexistent id (`not_found` → 404). Existence is not leaked, which
 * is what makes ids safe to expose in URLs.
 */
export async function readEvent(actor: Actor, eventId: unknown): Promise<EventRecord> {
  const view = await eventView(actor);
  if (view.kind === "none") {
    await authorize(actor, "calendar.view.own");
    throw new ProductivityError("not_authorized", "This actor cannot see any events.");
  }
  const [row] = await getDb()
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, requireResourceId(eventId)),
        view.kind === "where" ? view.predicate : undefined,
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw new ProductivityError("not_found", "No such event.");
  }
  return recordOf(row);
}

export interface EventPage {
  items: EventRecord[];
  /** The `(startAt, id)` pair of the last row, i.e. where the next page starts. */
  nextCursor: { startAt: string; id: string } | null;
}

/**
 * What the list reads and search all accept. `category: null` means "uncategorized",
 * which is why the field distinguishes "absent" from "null".
 */
interface EventQuery {
  window: { from: unknown; to: unknown };
  limit?: number;
  cursor?: { startAt: string; id: string } | null;
  status?: unknown;
  category?: unknown;
  location?: unknown;
  attendeeUserId?: unknown;
}

/**
 * Shared body of both list queries and search: bounded window, filters, keyset
 * pagination on `(start_at, id)` — the exact order `events_owner_start_idx` covers,
 * so paging stays stable when two events start in the same second.
 *
 * `scope` is the caller's visibility predicate (plus an attendance filter when
 * asked for); filters are ANDed onto it, never onto an unscoped table read.
 */
async function queryEvents(scope: SQL, query: EventQuery & { text?: string }): Promise<EventPage> {
  const window = parseQueryWindow(query.window);
  const limit = clampPageSize(query.limit);

  const conditions: SQL[] = [
    scope,
    gte(events.startAt, window.from),
    lt(events.startAt, window.to),
  ];
  if (query.status !== undefined) {
    conditions.push(eq(events.status, requireStatus(query.status)));
  }
  if (query.category !== undefined) {
    // `categoryOf` maps "no category" to null, and `eq(col, null)` is never true
    // in SQL; an unassigned category has to be asked for with IS NULL.
    const category = categoryOf(query.category);
    conditions.push(category === null ? isNull(events.category) : eq(events.category, category));
  }
  if (query.location !== undefined) {
    const phrase = requireFilterText(query.location, "Location filter");
    conditions.push(sql`(${events.location} like ${likePattern(phrase)} escape '\\')`);
  }
  if (query.text !== undefined) {
    // Title and description only (§22); location and category are filters, so
    // searching them too would make a phrase and a chip mean the same thing.
    const pattern = likePattern(query.text);
    const title = sql`(${events.title} like ${pattern} escape '\\')`;
    const description = sql`(${events.description} like ${pattern} escape '\\')`;
    conditions.push(sql`(${title} or ${description})`);
  }
  if (query.cursor) {
    const startAt = requireCursorInstant(query.cursor.startAt);
    const id = requireResourceId(query.cursor.id);
    const after = or(
      gt(events.startAt, startAt),
      and(eq(events.startAt, startAt), gt(events.id, id)),
    );
    if (after !== undefined) conditions.push(after);
  }

  const rows = await getDb()
    .select()
    .from(events)
    .where(and(...conditions))
    .orderBy(asc(events.startAt), asc(events.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(recordOf),
    nextCursor:
      rows.length > limit && last !== undefined ? { startAt: last.startAt, id: last.id } : null,
  };
}

/**
 * The actor's own events in a window, oldest first.
 *
 * A window is mandatory rather than "default to everything": an unbounded
 * calendar query grows with the user's history, so the service refuses it with
 * `window_too_large` / `invalid_window` instead of scanning the table.
 *
 * `attendeeUserId` narrows to events that account attends. It is refused unless
 * the id is the actor's own or the actor holds `calendar.view.any`: otherwise any
 * account could enumerate another person's invitations, which the participant
 * table exists to make visible only to the people involved.
 */
export async function listEvents(actor: Actor, query: EventQuery): Promise<EventPage> {
  const view = await eventView(actor);
  if (view.kind === "none") {
    await authorize(actor, "calendar.view.own");
    throw new ProductivityError("not_authorized", "This actor cannot see any events.");
  }
  return queryEvents(viewScope(view, await attendeeScope(actor, query.attendeeUserId)), query);
}

/**
 * Events the actor was invited to, in a window, oldest first.
 *
 * This is the participant-scoped read the schema's `event_participants_user_idx`
 * exists for. It is refused (not emptied) unless the actor holds a view permission
 * that can include other people's events.
 */
export async function listEventsAttendedBy(actor: Actor, query: EventQuery): Promise<EventPage> {
  if (!(await can(actor, "calendar.view.shared"))) {
    await authorize(actor, "calendar.view.shared");
  }
  return queryEvents(participantClause(actor.userId), query);
}

/**
 * Search titles and descriptions inside a window (§22), oldest first.
 *
 * Search is not a second view of the data: the actor's `calendar.*` grants still
 * decide which rows a phrase may match, so a `user` cannot search across another
 * account's private events. `search.view` only decides whether the search box
 * exists at all. The window stays mandatory for the same reason it is mandatory
 * for the agenda — an unbounded `LIKE` scan grows with history.
 *
 * Matching is SQLite `LIKE`: case-insensitive for ASCII, case-sensitive for the
 * rest, with wildcards in the phrase escaped so `10%` searches for literal text
 * instead of matching everything after `10`.
 */
export async function searchEvents(
  actor: Actor,
  query: EventQuery & { text: unknown },
): Promise<EventPage> {
  await authorize(actor, "search.view");
  const text = searchPhrase(query.text);
  const view = await eventView(actor);
  if (view.kind === "none") {
    await authorize(actor, "calendar.view.own");
    throw new ProductivityError("not_authorized", "This actor cannot see any events.");
  }
  const scope = viewScope(view, await attendeeScope(actor, query.attendeeUserId));
  return queryEvents(scope, { ...query, text });
}

/** The actor's visibility predicate, ANDed with an attendance filter if given. */
function viewScope(view: EventView, attendee: SQL | null): SQL {
  const visible = view.kind === "where" ? view.predicate : sql`1 = 1`;
  if (attendee === null) return visible;
  return sql`(${visible}) and (${attendee})`;
}

/**
 * `attendeeUserId` as a scope predicate, or null when the caller did not filter
 * by attendance. Another account's id is honoured only for an actor who may already
 * see any event — see `listEvents`.
 */
async function attendeeScope(actor: Actor, userIdValue: unknown): Promise<SQL | null> {
  if (userIdValue === undefined || userIdValue === null) return null;
  const userId = requireResourceId(userIdValue);
  if (userId !== actor.userId && !(await can(actor, "calendar.view.any"))) {
    throw new ProductivityError(
      "not_authorized",
      "Filtering by another account's attendance requires calendar.view.any.",
    );
  }
  return participantClause(userId);
}

/**
 * "Is this event one that `userId` attends?" as a SQL predicate. Correlated
 * `EXISTS` keeps the query a single statement against `events`, so the participant
 * index is used without loading every invitation first.
 */
function participantClause(userId: string): SQL {
  return sql`exists (
    select 1 from ${event_participants}
    where ${event_participants.eventId} = ${events.id}
      and ${event_participants.userId} = ${userId}
  )`;
}

/** Cursor timestamps are trusted only as far as the stored canonical form. */
function requireCursorInstant(value: string): string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?Z$/.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new ProductivityError("invalid_window", "The pagination cursor is malformed.");
  }
  return value;
}

/**
 * Validate an instant and return the exact text that will be stored or compared.
 * `requireInstant` returns epoch milliseconds, which is useless for the
 * `updated_at` token and cursor comparisons below — those are text comparisons
 * against canonical UTC, so the string itself is what callers need back.
 */
function instantText(value: unknown, label: string): string {
  requireInstant(value, label);
  if (typeof value !== "string" || !INSTANT_SHAPE.test(value)) {
    throw new ProductivityError("invalid_instant", `${label} must be an ISO-8601 instant.`);
  }
  return value.trim();
}

/**
 * Validate a filter phrase: a non-empty string no longer than the column it is
 * matched against. An over-length filter can never match, so it is rejected as
 * input rather than silently returning nothing.
 */
function requireFilterText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProductivityError("invalid_filter", `${label} must be a non-empty string.`);
  }
  const phrase = value.trim();
  if (phrase.length > MAX_EVENT_LOCATION_LENGTH) {
    throw new ProductivityError(
      "invalid_filter",
      `${label} may be at most ${MAX_EVENT_LOCATION_LENGTH} characters.`,
    );
  }
  return phrase;
}

/**
 * Validate a search phrase (§22). Empty is refused rather than treated as "match
 * everything": a search box that matches the whole window is a trap, not a default.
 */
function searchPhrase(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new ProductivityError("invalid_query", "Search needs a non-empty phrase.");
  }
  const phrase = value.trim();
  if (phrase.length > MAX_SEARCH_QUERY_LENGTH) {
    throw new ProductivityError(
      "query_too_long",
      `A search phrase may be at most ${MAX_SEARCH_QUERY_LENGTH} characters.`,
    );
  }
  return phrase;
}

/**
 * A `LIKE` pattern for a literal phrase. SQLite gives `LIKE` no default escape
 * character, so every pattern built here is paired with `escape '\'` in SQL; without
 * that, a phrase containing `%` or `_` would match unrelated rows.
 */
function likePattern(phrase: string): string {
  const escaped = phrase.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
  return `%${escaped}%`;
}

/**
 * Validate a query window: forward in time, and at most
 * `MAX_QUERY_WINDOW_DAYS` wide. Both list reads run through this, so no caller
 * can turn a calendar query into a full-table scan by omitting the bounds.
 */
function parseQueryWindow(window: { from?: unknown; to?: unknown }): { from: string; to: string } {
  const from = instantText(window.from, "Window start");
  const to = instantText(window.to, "Window end");
  if (Date.parse(to) <= Date.parse(from)) {
    throw new ProductivityError("invalid_window", "The query window must run forward in time.");
  }
  if (Date.parse(to) - Date.parse(from) > MAX_QUERY_WINDOW_DAYS * 86_400_000) {
    throw new ProductivityError(
      "window_too_large",
      `A query window may span at most ${MAX_QUERY_WINDOW_DAYS} days.`,
    );
  }
  return { from, to };
}

export interface ParticipantRecord {
  eventId: string;
  userId: string;
  /** Null when the invitation predates attribution or was made by the owner. */
  addedBy: string | null;
  createdAt: string;
}

/**
 * Who is invited to one event, ordered by user id so paging is deterministic.
 *
 * The event's own `ownerUserId` is deliberately not folded into this list: the
 * owner attends by definition, and inventing a row for them would let a later
 * "remove" appear to succeed against something that was never an invitation.
 */
export async function listEventParticipants(
  actor: Actor,
  eventId: unknown,
): Promise<ParticipantRecord[]> {
  const row = await visibleEventOrThrow(actor, eventId);
  const rows = await getDb()
    .select({
      eventId: event_participants.eventId,
      userId: event_participants.userId,
      addedBy: event_participants.addedBy,
      createdAt: event_participants.createdAt,
    })
    .from(event_participants)
    .where(eq(event_participants.eventId, row.id))
    .orderBy(asc(event_participants.userId))
    .limit(MAX_PAGE_SIZE);
  return rows;
}

/**
 * Resolve an event id through the actor's view, raising `not_found` for both a
 * missing id and one that exists but is invisible. Shared by the participant and
 * tag writes so none of them can be used as an existence oracle.
 */
async function visibleEventOrThrow(actor: Actor, eventId: unknown): Promise<EventRow> {
  const view = await eventView(actor);
  if (view.kind === "none") {
    await authorize(actor, "calendar.view.own");
    throw new ProductivityError("not_authorized", "This actor cannot see any events.");
  }
  const [row] = await getDb()
    .select()
    .from(events)
    .where(
      and(
        eq(events.id, requireResourceId(eventId)),
        view.kind === "where" ? view.predicate : undefined,
      ),
    )
    .limit(1);
  if (row === undefined) {
    throw new ProductivityError("not_found", "No such event.");
  }
  return row;
}

/**
 * Invite one account to an event.
 *
 * Three refusals in order of what the caller may not do at all: no `calendar.share`
 * → 403; an event this actor cannot edit → 403; then the two integrity cases —
 * inviting the owner (`participant_is_owner`) and inviting an account that does
 * not exist (`invalid_participant`). The unique index decides duplicates, so two
 * concurrent invitations cannot both land.
 */
export async function addParticipant(
  actor: Actor,
  input: { actor: Actor; eventId: unknown; userId: unknown },
): Promise<ParticipantRecord> {
  await authorize(actor, "calendar.share");
  const row = await visibleEventOrThrow(actor, input.eventId);
  if (row.ownerUserId !== actor.userId && !(await can(actor, "calendar.edit.any"))) {
    throw new ProductivityError("not_authorized", "This event belongs to another account.");
  }

  const userId = requireResourceId(input.userId);
  if (userId === row.ownerUserId) {
    throw new ProductivityError(
      "participant_is_owner",
      "The event owner already attends; an invitation is not needed.",
    );
  }
  const [invitee] = await getDb()
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (invitee === undefined) {
    throw new ProductivityError("invalid_participant", "The account to invite does not exist.");
  }

  const record: ParticipantRecord = {
    eventId: row.id,
    userId,
    addedBy: actor.userId,
    createdAt: new Date().toISOString(),
  };
  try {
    await getDb().insert(event_participants).values({
      id: randomUUID(),
      eventId: record.eventId,
      userId: record.userId,
      addedBy: record.addedBy,
      createdAt: record.createdAt,
    });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ProductivityError("duplicate_participant", "This account is already invited.");
    }
    throw error;
  }
  return record;
}

/**
 * Remove one invitation. A second removal reports `not_found` rather than
 * succeeding quietly, because "already removed" is a client state bug worth
 * surfacing rather than swallowing.
 */
export async function removeParticipant(
  actor: Actor,
  input: { actor: Actor; eventId: unknown; userId: unknown },
): Promise<void> {
  await authorize(actor, "calendar.share");
  const row = await visibleEventOrThrow(actor, input.eventId);
  if (row.ownerUserId !== actor.userId && !(await can(actor, "calendar.edit.any"))) {
    throw new ProductivityError("not_authorized", "This event belongs to another account.");
  }
  const userId = requireResourceId(input.userId);
  const where = and(eq(event_participants.eventId, row.id), eq(event_participants.userId, userId));
  const [existing] = await getDb()
    .select({ eventId: event_participants.eventId })
    .from(event_participants)
    .where(where)
    .limit(1);
  if (existing === undefined) {
    throw new ProductivityError("not_found", "This account is not invited to the event.");
  }
  await getDb().delete(event_participants).where(where);
}

/**
 * Tags linked to one event, ordered by name. The tag visibility predicate from
 * `src/lib/tags.ts` is applied here too, so an event tagged with a tag this
 * actor cannot see reads as untagged rather than leaking the tag's name.
 *
 * Event tags live in the packet 2A `tag_links` table under
 * `resource_type = 'event'`; there is no separate event-tag table, so a tag
 * rename is one row for every resource kind.
 */
export async function listEventTags(actor: Actor, eventId: unknown): Promise<string[]> {
  const row = await visibleEventOrThrow(actor, eventId);
  const view = await tagView(actor);
  if (view.kind === "none") {
    await authorize(actor, "tags.view.own");
    return [];
  }
  if (view.kind === "empty") return [];

  const scope = view.kind === "all" ? undefined : view.predicate;
  const rows = await getDb()
    .select({ name: tags.name })
    .from(tag_links)
    .innerJoin(tags, eq(tags.id, tag_links.tagId))
    .where(and(eq(tag_links.resourceType, "event"), eq(tag_links.resourceId, row.id), scope))
    .orderBy(asc(tags.name))
    .limit(MAX_PAGE_SIZE);
  return rows.map((entry) => entry.name);
}

/**
 * Link one of the actor's own visible tags to an event. The event is read under
 * the actor's own edit permission first — that is the resource-side half of the
 * `assertTagUsable` contract documented in `src/lib/tags.ts`: the link is only
 * ever written for a resource this service has just authorized. The tag is
 * resolved through `findTag`, so a tag this actor cannot see is not found
 * rather than a row only the database can see. Duplicate links are an idempotent
 * no-op, mirroring `attachTag`, because the database's unique index decides
 * duplicates anyway.
 */
export async function addEventTag(
  actor: Actor,
  input: { actor: Actor; eventId: unknown; tagId: unknown },
): Promise<TagLinkSummary> {
  await authorize(actor, "calendar.share");
  const row = await visibleEventOrThrow(actor, input.eventId);
  if (row.ownerUserId !== actor.userId && !(await can(actor, "calendar.edit.any"))) {
    throw new ProductivityError("not_authorized", "This event belongs to another account.");
  }
  return attachTag(input.actor, {
    tagId: requireResourceId(input.tagId),
    resourceType: "event",
    resourceId: row.id,
  });
}

/**
 * Remove an event tag link. Mirrors `detachTag`: the tag must be one of the
 * actor's own, and an absent link is `false` rather than an error, because
 * "remove it" is satisfied by a link that is already gone.
 */
export async function removeEventTag(
  actor: Actor,
  input: { actor: Actor; eventId: unknown; tagId: unknown },
): Promise<boolean> {
  await authorize(actor, "calendar.share");
  const row = await visibleEventOrThrow(actor, input.eventId);
  if (row.ownerUserId !== actor.userId && !(await can(actor, "calendar.edit.any"))) {
    throw new ProductivityError("not_authorized", "This event belongs to another account.");
  }
  return detachTag(input.actor, {
    tagId: requireResourceId(input.tagId),
    resourceType: "event",
    resourceId: row.id,
  });
}
