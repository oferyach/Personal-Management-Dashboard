/**
 * Shared productivity vocabulary (packet 2A).
 *
 * One place where the words later Phase 2 modules share are defined, so 2B (events),
 * 2D (tasks), 2G (projects), 2Q (activity) and 2S (search) cannot each invent their
 * own spelling of the same concept. Every value that crosses a service boundary is
 * checked against these lists before it reaches SQL.
 *
 * Traceability: `README.md` §7 (tasks: status, priority, progress, tags), §13 (tags
 * and tag associations are first-class), §16 (activity actions: event creation and
 * modification, task creation and completion, task progress changes, project updates,
 * asset metadata changes, synchronization operations), §22 (tag management).
 */

/**
 * Kinds of productivity resource that can carry tags and appear in the activity
 * feed. `asset` is included because §13/§16 already promise asset metadata changes
 * and tagged assets; the table itself arrives in Phase 4.
 */
export const PRODUCTIVITY_RESOURCE_KINDS = ["event", "task", "project", "asset"] as const;
export type ProductivityResourceKind = (typeof PRODUCTIVITY_RESOURCE_KINDS)[number];

/**
 * `tag` is added to the resource kinds above for the activity feed only: §16
 * requires "all user-visible actions", and creating, renaming or deleting a tag is
 * such an action.
 */
export const ACTIVITY_RESOURCE_KINDS = [...PRODUCTIVITY_RESOURCE_KINDS, "tag"] as const;
export type ActivityResourceKind = (typeof ACTIVITY_RESOURCE_KINDS)[number];

/**
 * The activity action vocabulary. Machine values: never translated (§22), stored
 * verbatim, and constrained by this list rather than by free text.
 */
export const ACTIVITY_ACTIONS = [
  "created",
  "updated",
  "deleted",
  "completed",
  "reopened",
  "progress_changed",
  "tag_attached",
  "tag_detached",
  "metadata_changed",
  "synchronized",
] as const;
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number];

/**
 * The three visibility levels every productivity permission encodes, mirroring
 * Phase 1's `view.own` / `view.shared` / `view.any` split. `own` is the actor's
 * own work, `shared` is a resource explicitly shared with the actor through
 * `resource_permissions`, `any` is the administrative global view.
 */
/**
 * Event status vocabulary (packet 2B). Spelled to match iCalendar `STATUS`
 * (`TENTATIVE|CONFIRMED|CANCELLED`, RFC 5544/5545) because packet 2.5 has to
 * serialize this column into `.ics` without a later migration rewriting the
 * `events_status_chk` constraint. Kept here rather than in the events module because
 * the calendar filters (2C), search (2S) and dashboard (2.10) all read it.
 */
export const EVENT_STATUSES = ["tentative", "confirmed", "cancelled"] as const;
export type EventStatus = (typeof EVENT_STATUSES)[number];

export const VISIBILITIES = ["own", "shared", "any"] as const;
export type Visibility = (typeof VISIBILITIES)[number];

/** Largest page size a caller may ask for; mirrors the audit-list bound. */
export const MAX_PAGE_SIZE = 200;

/** Longest tag name, in characters, after normalization. */
export const TAG_NAME_MAX_LENGTH = 40;

/**
 * Longest date window a list query may span. Without a bound, "list all my tasks
 * before 2030" turns a paginated feed into a full table scan on a VPS.
 */
export const MAX_QUERY_WINDOW_DAYS = 366;

/** Longest resource id accepted by the tag/activity link columns. */
export const MAX_RESOURCE_ID_LENGTH = 191;

/**
 * Event field bounds, mirrored by the `events_*_chk` constraints in
 * `drizzle/0003_phase2b_events.sql`. The service rejects over-length input with a
 * reason; the database is what makes it impossible to bypass that.
 */
export const MAX_EVENT_TITLE_LENGTH = 300;
export const MAX_EVENT_DESCRIPTION_LENGTH = 5000;
export const MAX_EVENT_CATEGORY_LENGTH = 60;
export const MAX_EVENT_LOCATION_LENGTH = 300;
/** `#rrggbb` — the only color form the calendar UI, `.ics` export and CSS accept. */
export const EVENT_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
/**
 * Longest search phrase the event search service accepts. A search is not a
 * denial-of-service vector only because it is bounded, and the phrase is echoed
 * back to the caller by the UI, so it has to fit a line.
 */
export const MAX_SEARCH_QUERY_LENGTH = 200;

/**
 * Every failure a productivity service can raise for bad input or a denied
 * request. One class, so a future `/api/v1` route maps `reason` onto an HTTP
 * status in one place:
 *
 * - `not_found` → 404. Covers "does not exist" and "exists but is not visible to
 *    this actor" with the same answer, so guessing another user's id cannot
 *    confirm that it exists.
 * - `not_authorized` → 403. The row is visible to the actor but they may not
 *    perform this operation on it.
 * - `version_conflict` → 409. The caller read a row another writer has since
 *    changed; re-read and re-apply. Distinct from 400 because the caller must
 *    fetch a new `updatedAt`, not fix the shape of their request.
 * - the rest → 400.
 */
export type ProductivityErrorReason =
  | "invalid_tag_name"
  | "tag_name_too_long"
  | "duplicate_tag"
  | "duplicate_link"
  | "unknown_resource_kind"
  | "unknown_activity_action"
  | "invalid_detail"
  | "invalid_resource_id"
  | "invalid_window"
  | "window_too_large"
  | "invalid_page_size"
  | "not_found"
  | "not_authorized"
  // Event input and concurrency (packet 2B). `version_conflict` is the optimistic
  // `updated_at` mismatch: the caller's expected value is stale, so a route maps
  // it to 409 instead of re-reading and silently overwriting another write.
  | "invalid_title"
  | "title_too_long"
  | "invalid_description"
  | "description_too_long"
  | "invalid_instant"
  | "inverted_range"
  | "invalid_timezone"
  | "invalid_all_day"
  | "invalid_status"
  | "invalid_color"
  | "invalid_category"
  | "category_too_long"
  | "invalid_location"
  | "location_too_long"
  | "invalid_participant"
  | "participant_is_owner"
  | "duplicate_participant"
  | "version_conflict"
  // Search and filter input (packet 2C). `invalid_query` is a missing or blank
  // phrase, `query_too_long` its length, `invalid_filter` a value the events
  // table cannot express (an unknown status, a non-string category or location).
  | "invalid_query"
  | "query_too_long"
  | "invalid_filter";

export class ProductivityError extends Error {
  readonly reason: ProductivityErrorReason;

  constructor(reason: ProductivityErrorReason, message: string) {
    super(message);
    this.name = "ProductivityError";
    this.reason = reason;
  }
}

/**
 * True for a SQLite unique-constraint failure. The services let the database
 * decide uniqueness and translate the failure into a `ProductivityError`; they
 * never pre-check "does this exist" in a separate query, which would race.
 * Matches better-sqlite3's `SQLITE_CONSTRAINT_UNIQUE` code and message.
 */
export function isUniqueConstraintError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") return true;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" && /UNIQUE constraint/i.test(message);
}

export function isProductivityResourceKind(value: unknown): value is ProductivityResourceKind {
  return (PRODUCTIVITY_RESOURCE_KINDS as readonly string[]).includes(value as string);
}

export function isActivityResourceKind(value: unknown): value is ActivityResourceKind {
  return (ACTIVITY_RESOURCE_KINDS as readonly string[]).includes(value as string);
}

export function isActivityAction(value: unknown): value is ActivityAction {
  return (ACTIVITY_ACTIONS as readonly string[]).includes(value as string);
}

export function isEventStatus(value: unknown): value is EventStatus {
  return (EVENT_STATUSES as readonly string[]).includes(value as string);
}

/**
 * Which visibility level a permission key encodes. Services ask "what level of
 * access do I have here" instead of string-matching in three modules.
 * Returns null for keys that are not visibility-scoped (`tags.create`).
 */
export function visibilityOf(permissionKey: string): Visibility | null {
  if (permissionKey.endsWith(".any")) return "any";
  if (permissionKey.endsWith(".shared")) return "shared";
  if (permissionKey.endsWith(".own")) return "own";
  return null;
}

/**
 * The one tag-name rule, shared by the tag service and by search (2S) so a
 * search for "Work" finds the tag the user typed as "  work  ".
 *
 * 1. Control characters (C0, C1, DEL) are rejected outright — they would make a
 *    tag invisible in a list and untypeable.
 * 2. Unicode NFC, so a composed and a decomposed spelling of the same Hebrew or
 *    accented name are one tag.
 * 3. Every whitespace run (including NBSP) collapses to one space, then trims.
 * 4. `toLowerCase()` — deliberately locale-independent, so the stored form is
 *    identical on the VPS, in CI and in a test, and no locale table is needed.
 *
 * `display` keeps what the user typed (modulo 1–3) for the UI; `normalized` is
 * what `tags.name_normalized` and the unique index use.
 */
export function normalizeTagName(raw: unknown): { display: string; normalized: string } {
  if (typeof raw !== "string") {
    throw new ProductivityError("invalid_tag_name", "Tag name must be a string.");
  }
  if (/[\u0000-\u001F\u007F\u0080-\u009F]/.test(raw)) {
    throw new ProductivityError(
      "invalid_tag_name",
      "Tag names may not contain control characters.",
    );
  }
  const display = raw.normalize("NFC").replace(/\s+/gu, " ").trim();
  if (display.length === 0) {
    throw new ProductivityError("invalid_tag_name", "Tag name must not be empty.");
  }
  if (display.length > TAG_NAME_MAX_LENGTH) {
    throw new ProductivityError(
      "tag_name_too_long",
      `Tag name must be at most ${TAG_NAME_MAX_LENGTH} characters.`,
    );
  }
  return { display, normalized: display.toLowerCase() };
}

/**
 * A resource id as stored by the owning module (UUID or short public id). The
 * shape is validated here; existence and edit rights belong to the module that
 * owns the table (2B/2D/2G), which is why this packet never fabricates a
 * resource to make a link look valid.
 */
export function requireResourceId(value: unknown): string {
  if (typeof value !== "string") {
    throw new ProductivityError("invalid_resource_id", "Resource id must be a string.");
  }
  if (value.length === 0 || value.length > MAX_RESOURCE_ID_LENGTH) {
    throw new ProductivityError(
      "invalid_resource_id",
      `Resource id must be 1-${MAX_RESOURCE_ID_LENGTH} characters.`,
    );
  }
  if (/[\u0000-\u001F\u007F\u0080-\u009F\s]/.test(value)) {
    throw new ProductivityError(
      "invalid_resource_id",
      "Resource ids may not contain whitespace or control characters.",
    );
  }
  return value;
}

/** A validated, inclusive-exclusive ISO-UTC date window for a list query. */
export interface QueryWindow {
  from: string;
  to: string;
}

/**
 * ISO-8601 only. A US-style `12/05/2026` is rejected rather than guessed, which
 * is the same rule §6 applies to calendar queries.
 */
const ISO_SHAPE = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:?\d{2})?)?$/;

export function parseQueryWindow(input: { from: unknown; to: unknown }): QueryWindow {
  const from = instant(input.from);
  const to = instant(input.to);
  if (from === null || to === null) {
    throw new ProductivityError("invalid_window", "from and to must be ISO-8601 timestamps.");
  }
  if (from >= to) {
    throw new ProductivityError("invalid_window", "from must be before to.");
  }
  if (to - from > MAX_QUERY_WINDOW_DAYS * 86_400_000) {
    throw new ProductivityError(
      "window_too_large",
      `A query window may span at most ${MAX_QUERY_WINDOW_DAYS} days.`,
    );
  }
  return { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
}

function instant(value: unknown): number | null {
  if (typeof value !== "string" || !ISO_SHAPE.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** Page size clamp shared by the tag and activity list services. */
export function clampPageSize(value: unknown, fallback = 50): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, MAX_PAGE_SIZE);
}
