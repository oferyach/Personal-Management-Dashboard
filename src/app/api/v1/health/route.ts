import { errorResponse, json, newRequestId } from "@/lib/http";
import { getHealthSnapshot } from "@/lib/health";

export const dynamic = "force-dynamic";

/**
 * GET /api/v1/health
 * Reports measured state only: SQLite pragmas, applied migration count and
 * worker heartbeat. Deliberately contains no secrets and no absolute paths.
 */
export async function GET(): Promise<Response> {
  try {
    const snapshot = getHealthSnapshot();
    return json(snapshot, { status: snapshot.status === "ok" ? 200 : 503 });
  } catch (error) {
    return errorResponse(error, newRequestId());
  }
}
