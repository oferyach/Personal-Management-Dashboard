import { z } from "zod";

import {
  actionContextForApi,
  apiErrorResponse,
  ApiInputError,
  parseJson,
  requireSameOrigin,
} from "@/lib/api";
import { resolveApiUser } from "@/lib/requestAuth";
import { assignUserRole, setAccountActive } from "@/lib/userAdministration";

const updateSchema = z
  .object({
    role: z.enum(["super_admin", "admin", "user", "read_only"]).optional(),
    active: z.boolean().optional(),
    reason: z.string().trim().max(120).optional(),
  })
  .strict()
  .refine((value) => Number(value.role !== undefined) + Number(value.active !== undefined) === 1);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser();
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const input = await parseJson(request, updateSchema);
    const { userId } = await params;
    if (!userId) throw new ApiInputError("invalid_user_id");
    const ctx = actionContextForApi(actor.user, request);
    const user = input.role
      ? await assignUserRole(ctx, userId, input.role)
      : await setAccountActive(ctx, userId, input.active!, input.reason);
    return Response.json({ data: user });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
