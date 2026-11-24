import { readRoleMatrix } from "@/lib/rbac";
import { resolveApiUser } from "@/lib/requestAuth";

export async function GET(): Promise<Response> {
  const actor = await resolveApiUser("roles.view");
  if (!actor.ok) return Response.json({ error: actor.code }, { status: actor.status });
  return Response.json({ data: await readRoleMatrix() });
}
