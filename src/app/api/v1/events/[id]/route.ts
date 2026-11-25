import { apiErrorResponse, ApiInputError, parseJson, requireSameOrigin } from "@/lib/api";
import {
  deleteEvent,
  duplicateEvent,
  readEvent,
  updateEvent,
  type EventDelete,
  type EventUpdate,
} from "@/lib/events";
import { duplicateEventBody, updateEventBody } from "@/lib/eventsApi";
import { resolveApiUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/events/{id}
 *
 * `readEvent` puts the caller's view predicate in the `WHERE`, so an id owned by
 * someone else and an id that does not exist produce the same 404. The route
 * therefore has nothing to hide: it forwards whatever the service answers.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const actor = await resolveApiUser();
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
  try {
    const { id } = await params;
    if (!id) throw new ApiInputError("invalid_id");
    return Response.json({ data: await readEvent(actor.user.actor, id) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * PATCH /api/v1/events/{id}
 *
 * `expectedUpdatedAt` is required and travels in the `UPDATE ... WHERE`, so a
 * stale tab gets `version_conflict` (409) instead of overwriting a newer row.
 * Time fields are re-normalized as a set by the service: sending only `start`
 * keeps the stored `end`.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser();
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const { id } = await params;
    if (!id) throw new ApiInputError("invalid_id");
    const body = await parseJson(request, updateEventBody);
    const updated = await updateEvent(actor.user.actor, {
      actor: actor.user.actor,
      eventId: id,
      expectedUpdatedAt: body.expectedUpdatedAt,
      title: body.title,
      description: body.description,
      start: body.start,
      end: body.end,
      allDay: body.allDay,
      timezone: body.timezone,
      status: body.status,
      category: body.category,
      color: body.color,
      location: body.location,
    } satisfies EventUpdate);
    return Response.json({ data: updated });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/v1/events/{id} — duplicate.
 *
 * Takes no fields: the copy is built by the service from the stored row, gets a
 * fresh id, and carries no recurrence identity, so duplicating a copy of a
 * recurring event never inherits a rule the caller cannot see.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser();
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const { id } = await params;
    if (!id) throw new ApiInputError("invalid_id");
    await parseJson(request, duplicateEventBody);
    const copy = await duplicateEvent(actor.user.actor, id);
    return Response.json({ data: copy }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * DELETE /api/v1/events/{id}
 *
 * `?expectedUpdatedAt=` is optional here, unlike on PATCH: deleting is the one
 * case where "remove this whatever changed in between" is a legitimate request.
 * The service returns the row as it was before deletion, so a UI can offer undo.
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser();
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const { id } = await params;
    if (!id) throw new ApiInputError("invalid_id");
    const token = new URL(request.url).searchParams.get("expectedUpdatedAt");
    const input: EventDelete = {
      actor: actor.user.actor,
      eventId: id,
      ...(token === null ? {} : { expectedUpdatedAt: token }),
    };
    const removed = await deleteEvent(actor.user.actor, input);
    return Response.json({ data: removed });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
