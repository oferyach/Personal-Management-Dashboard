import { apiErrorResponse } from "@/lib/api";
import { searchEvents } from "@/lib/events";
import { eventSearchParams, parseQuery, toEventQuery } from "@/lib/eventsApi";
import { resolveApiUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/events/search?q=…&from=…&to=…
 *
 * `q` matches titles and descriptions; the window stays mandatory so a phrase
 * cannot turn into a scan of the account's whole history. The caller's calendar
 * grants still decide which rows a phrase may match — `search.view` only decides
 * whether searching is allowed at all — so this route adds no wider visibility
 * than `/api/v1/events` already has.
 */
export async function GET(request: Request): Promise<Response> {
  const actor = await resolveApiUser();
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
  try {
    const params = parseQuery(request, eventSearchParams);
    const page = await searchEvents(actor.user.actor, {
      ...toEventQuery(params),
      text: params.q,
    });
    return Response.json({ data: page });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
