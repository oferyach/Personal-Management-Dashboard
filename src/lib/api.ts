import "server-only";

import { z } from "zod";

import { ActionError } from "@/lib/actionError";
import { getConfig } from "@/lib/env";
import type { ActionContext } from "@/lib/requestAuth";
import type { AuthenticatedUser } from "@/lib/sessions";

export class ApiInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ApiInputError";
  }
}

export async function parseJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw new ApiInputError("invalid_json");
  }
  const result = schema.safeParse(body);
  if (!result.success) throw new ApiInputError("invalid_input");
  return result.data;
}

export function requireSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  // Compare against the configured public origin, not Request.url: behind the
  // reverse proxy the latter may describe an internal host/port.
  const expected = new URL(getConfig().appUrl).origin;
  // Reject an asserted foreign origin. Same-origin Chromium requests and
  // non-browser API clients may omit Origin; unsafe cross-origin fetches are also
  // constrained by CORS and the session cookie's SameSite policy.
  if (origin && origin !== expected) throw new ApiInputError("invalid_origin");
}

export function actionContextForApi(user: AuthenticatedUser, request: Request): ActionContext {
  return { user, state: "authenticated", headers: request.headers };
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiInputError) {
    return Response.json(
      { error: error.code },
      { status: error.code === "invalid_origin" ? 403 : 400 },
    );
  }
  if (error instanceof ActionError) {
    const status =
      error.notice === "unauthorized"
        ? 401
        : error.notice === "forbidden" || error.notice === "not_assignable"
          ? 403
          : error.notice === "account_not_found"
            ? 404
            : error.notice === "rate_limited"
              ? 429
              : 400;
    return Response.json({ error: error.notice, code: error.machineCode }, { status });
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}
