import "server-only";

import { z } from "zod";

import { ApiInputError } from "@/lib/api";
import { EVENT_STATUSES, ProductivityError } from "@/lib/productivity";

/**
 * Wire shapes for `/api/v1/events` (packet 2C).
 *
 * The route layer validates *shape* — strict objects, bounded strings, known
 * status values — and hands the values to `src/lib/events.ts`, which owns their
 * grammar (instant vs. day, IANA zone, colour pattern) and the RBAC decision.
 * Keeping the two apart is what makes a client error distinguishable from a
 * permission error on the wire, and it means the routes cannot drift from the
 * service's rules: they never re-implement a check the service already makes.
 */

/**
 * A value the service will interpret. The cap is transport-level only — it stops
 * an unbounded payload becoming a carrier for something else — while the real
 * per-field limits (`MAX_EVENT_*`) stay in the service, so its precise reason
 * codes (`title_too_long`, `invalid_instant`, …) are what a client sees.
 */
const bounded = z.string().min(1).max(200);
const prose = z.string().max(4000);

/**
 * `POST /api/v1/events`. `ownerUserId` is accepted only so an administrator can
 * create an event on another account's behalf; `createEvent` refuses it for
 * anyone who does not hold `calendar.edit.any`.
 */
export const createEventBody = z
  .object({
    title: prose,
    start: bounded,
    end: bounded.optional(),
    description: prose.optional(),
    timezone: bounded.optional(),
    allDay: z.boolean().optional(),
    status: z.enum(EVENT_STATUSES).optional(),
    category: prose.optional(),
    color: bounded.optional(),
    location: prose.optional(),
    ownerUserId: bounded.optional(),
  })
  .strict();

/**
 * `PATCH /api/v1/events/{id}`. `expectedUpdatedAt` is mandatory: it is the token
 * from the read the caller based its edit on, and an update without it would
 * silently overwrite another tab's work. At least one field must change.
 */
export const updateEventBody = z
  .object({
    expectedUpdatedAt: bounded,
    title: prose.optional(),
    description: prose.optional(),
    start: bounded.optional(),
    end: bounded.optional(),
    allDay: z.boolean().optional(),
    timezone: bounded.optional(),
    status: z.enum(EVENT_STATUSES).optional(),
    category: prose.optional(),
    color: bounded.optional(),
    location: prose.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 1);

/**
 * `POST /api/v1/events/{id}` — duplicate. No fields: the copy is made by the
 * service from the stored row, gets a new id, and carries no recurrence identity
 * (that belongs to packet 2E and later).
 */
export const duplicateEventBody = z.object({}).strict();

/**
 * Query string shared by `GET /api/v1/events`, `GET /api/v1/events/attending`
 * and `GET /api/v1/events/search`.
 *
 * `from` and `to` are required: an unbounded calendar query grows with the
 * account's history, so the service refuses it rather than scanning. Unknown
 * parameters are rejected instead of ignored, because a typo'd filter reads as
 * "the filter worked" to the caller.
 */
export const eventListParams = z
  .object({
    from: bounded,
    to: bounded,
    limit: z
      .string()
      .regex(/^\d{1,4}$/)
      .optional(),
    status: z.enum(EVENT_STATUSES).optional(),
    category: z.string().max(200).optional(),
    location: z.string().max(200).optional(),
    attendee: bounded.optional(),
    cursorStartAt: bounded.optional(),
    cursorId: bounded.optional(),
  })
  .strict();

export const eventSearchParams = eventListParams.extend({ q: prose }).strict();

/**
 * Parsed query string in the shape the list and search services expect.
 *
 * `category` distinguishes three states on the wire: absent (no filter), empty
 * (only uncategorized events) and a value (exact match). A cursor is half a
 * cursor: both halves must be present or neither is honoured, otherwise a
 * truncated link would page from the wrong place.
 */
export function toEventQuery(
  source: z.infer<typeof eventListParams> | z.infer<typeof eventSearchParams>,
): {
  window: { from: string; to: string };
  limit?: number;
  cursor?: { startAt: string; id: string } | null;
  status?: string;
  category?: string | null;
  location?: string;
  attendeeUserId?: string;
} {
  const hasCursor = source.cursorStartAt !== undefined && source.cursorId !== undefined;
  if ((source.cursorStartAt === undefined) !== (source.cursorId === undefined)) {
    throw new ProductivityError("invalid_window", "A cursor needs both startAt and id.");
  }
  return {
    window: { from: source.from, to: source.to },
    limit: source.limit === undefined ? undefined : Number(source.limit),
    cursor: hasCursor ? { startAt: source.cursorStartAt!, id: source.cursorId! } : null,
    status: source.status,
    category:
      source.category === undefined ? undefined : source.category === "" ? null : source.category,
    location: source.location,
    attendeeUserId: source.attendee,
  };
}

/**
 * Validate a request's query string against `listParams` / `searchParams`.
 * A rejected parameter is a 400 with a machine code, never a silent default.
 */
export function parseQuery<Schema extends z.ZodObject>(
  request: Request,
  schema: Schema,
): z.infer<Schema> {
  const result = schema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!result.success) throw new ApiInputError("invalid_input");
  return result.data;
}
