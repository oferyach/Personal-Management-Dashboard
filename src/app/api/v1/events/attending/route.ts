import { apiErrorResponse, ApiInputError } from "@/lib/api";
import { listEventsAttendedBy } from "@/lib/events";
import { eventListParams, parseQuery, toEventQuery } from "@/lib/eventsApi";
import { resolveApiUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/events/attending — events the caller was invited to.
 *
 * The scope is the caller's own participant rows, taken from the path's meaning
 * rather than a query parameter, so a client cannot ask for someone else's
 * invitations. `listEventsAttendedBy` refuses (403) rather than returning an
 * empty list when the caller holds no permission that can include other people's
 * events — an empty list would read as "you attend nothing".
 */
export async function GET(request: Request): Promise<Response> {
  const actor = await resolveApiUser();
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
  try {
    const params = parseQuery(request, eventListParams);
    // The scope is this caller's own invitations; an `attendee` filter would ask
    // the endpoint to enumerate someone else's invitations, so it is rejected
    // rather than ignored.
    if (params.attendee !== undefined) throw new ApiInputError("attendee_not_allowed");
    const page = await listEventsAttendedBy(actor.user.actor, toEventQuery(params));
    return Response.json({ data: page });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
