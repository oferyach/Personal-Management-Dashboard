import { apiErrorResponse } from "@/lib/api";
import { AGENDA_HORIZON_DAYS, agendaParams, parseQuery, toAgendaQuery } from "@/lib/eventsApi";
import { listEvents } from "@/lib/events";
import { resolveApiUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/events/agenda — the next N events this caller may see.
 *
 * This is `listEvents` with a narrower query string, not a second read path:
 * the service decides visibility from the caller's `calendar.*` grants (own
 * rows, plus rows the caller attends, plus every row for an actor holding
 * `calendar.view.any`), orders by `(start_at, id)`, and pages on that same
 * pair. The route adds only the default window — from now to
 * `AGENDA_HORIZON_DAYS` days ahead — and echoes it, so a caller that sent no
 * bounds can tell exactly which span the server read.
 *
 * Filters are not accepted here; `?status=` or `?category=` is a 400 pointing
 * at `/api/v1/events`, where they belong.
 */
export async function GET(request: Request): Promise<Response> {
  const actor = await resolveApiUser();
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
  try {
    const query = toAgendaQuery(parseQuery(request, agendaParams));
    const page = await listEvents(actor.user.actor, query);
    return Response.json({
      data: {
        window: query.window,
        horizonDays: AGENDA_HORIZON_DAYS,
        items: page.items,
        nextCursor: page.nextCursor,
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
