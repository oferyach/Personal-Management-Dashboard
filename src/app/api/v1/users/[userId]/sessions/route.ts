import { actionContextForApi, apiErrorResponse, requireSameOrigin } from "@/lib/api";
import { resolveApiUser } from "@/lib/requestAuth";
import { revokeUserSessions } from "@/lib/userAdministration";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser();
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const { userId } = await params;
    const revoked = await revokeUserSessions(actionContextForApi(actor.user, request), userId);
    return Response.json({ data: { revoked } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
