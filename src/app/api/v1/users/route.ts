import { z } from "zod";

import { actionContextForApi, apiErrorResponse, parseJson, requireSameOrigin } from "@/lib/api";
import { resolveApiUser } from "@/lib/requestAuth";
import { createManagedUser, listManagedDirectory } from "@/lib/userAdministration";

export const dynamic = "force-dynamic";

const createSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    email: z.email().max(254),
    role: z.enum(["super_admin", "admin", "user", "read_only"]),
  })
  .strict();

export async function GET(request: Request): Promise<Response> {
  const actor = await resolveApiUser("users.view");
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") ?? 50);
  const offset = Number(url.searchParams.get("offset") ?? 0);
  return Response.json({ data: listManagedDirectory(limit, offset) });
}

export async function POST(request: Request): Promise<Response> {
  try {
    requireSameOrigin(request);
    const actor = await resolveApiUser();
    if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
    const input = await parseJson(request, createSchema);
    const created = await createManagedUser(actionContextForApi(actor.user, request), input);
    return Response.json({ data: created }, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
