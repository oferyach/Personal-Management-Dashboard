import { apiErrorResponse, parseJson, requireSameOrigin } from "@/lib/api";
import { createEvent, listEvents } from "@/lib/events";
import { createEventBody, eventListParams, parseQuery, toEventQuery } from "@/lib/eventsApi";
import { resolveApiUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/events — the calendar window.
 *
 * `listEvents` decides visibility from the caller's permissions (own rows, any
 * rows, or rows the caller attends) and answers `not_authorized` when the caller
 * holds no calendar permission at all; the route never filters rows itself.
 */
export async function GET(request: Request): Promise<Response> {
  const actor = await resolveApiUser();
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
  try {
    const page = await listEvents(
      actor.user.actor,
      toEventQuery(parseQuery(request, eventListParams)),
    );
    return Response.json({ data: page });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

/**
 * POST /api/v1/events — create one event.
 *
 * The body is shape-checked here and grammar-checked by the service, so a client
 * gets `invalid_input` for a malformed JSON body and codes such as `end_before_start`
 * or `invalid_instant` from the service. `ownerUserId` is passed through
 * untouched: only an actor holding `calendar.edit.any` may set it.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser();
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const body = await parseJson(request, createEventBody);
    const created = await createEvent(actor.user.actor, {
      actor: actor.user.actor,
      title: body.title,
      start: body.start,
      end: body.end,
      description: body.description,
      timezone: body.timezone,
      allDay: body.allDay,
      status: body.status,
      category: body.category,
      color: body.color,
      location: body.location,
      ownerUserId: body.ownerUserId,
    });
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
