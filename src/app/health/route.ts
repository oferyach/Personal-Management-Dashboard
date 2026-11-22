import { getHealthSnapshot } from "@/lib/health";
import { errorResponse, json, newRequestId } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * GET /health — unversioned liveness alias used by container healthchecks and
 * uptime monitors (docs/PLAN.md 0.3). Identical measured payload to
 * GET /api/v1/health, which is what the app UI and future tooling call.
 */
export async function GET(): Promise<Response> {
  try {
    const snapshot = getHealthSnapshot();
    return json(snapshot, { status: snapshot.status === "ok" ? 200 : 503 });
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
