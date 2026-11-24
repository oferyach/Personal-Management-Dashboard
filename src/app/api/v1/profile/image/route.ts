import { actionContextForApi, apiErrorResponse, requireSameOrigin } from "@/lib/api";
import { saveProfileImage } from "@/lib/profileImage";
import { resolveApiUser } from "@/lib/requestAuth";

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser("profile.edit_own");
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const form = await request.formData();
    const image = form.get("image");
    if (!(image instanceof File)) return Response.json({ error: "invalid_input" }, { status: 400 });
    const url = await saveProfileImage(actionContextForApi(actor.user, request), image);
    return Response.json({ data: { url } }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
