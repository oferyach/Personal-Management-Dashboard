import { actionContextForApi, apiErrorResponse, requireSameOrigin } from "@/lib/api";
import { resolveApiUser } from "@/lib/requestAuth";
import { resetUserPassword } from "@/lib/userAdministration";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser();
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const { userId } = await params;
    const result = await resetUserPassword(actionContextForApi(actor.user, request), userId);
    return Response.json({ data: result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
