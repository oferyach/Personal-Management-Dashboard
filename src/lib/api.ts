import "server-only";

import { z } from "zod";

import { ActionError } from "@/lib/actionError";
import { AuthorizationError } from "@/lib/rbac";
import { ProductivityError, type ProductivityErrorReason } from "@/lib/productivity";
import { getConfig } from "@/lib/env";
import type { ActionContext } from "@/lib/requestAuth";
import type { AuthenticatedUser } from "@/lib/sessions";

export class ApiInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ApiInputError";
  }
}

/**
 * A request body is read as text first so an oversized payload is rejected before
 * it is parsed or reaches a service. The cap is transport-level, not a business
 * rule: every field has its own limit inside the service.
 */
const MAX_BODY_CHARACTERS = 32_768;

async function readBody(request: Request): Promise<string> {
  const raw = await request.text();
  if (raw.length > MAX_BODY_CHARACTERS) throw new ApiInputError("body_too_large");
  return raw;
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiInputError("invalid_json");
  }
}

export async function parseJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const result = schema.safeParse(parseBody(await readBody(request)));
  if (!result.success) throw new ApiInputError("invalid_input");
  return result.data;
}

/**
 * `parseJson`, but an absent or empty body means `{}`. Used by routes whose
 * input is entirely in the path or query — `POST /events/{id}` duplicates an
 * event and takes no fields.
 */
export async function parseOptionalJson<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const raw = await readBody(request);
  const result = schema.safeParse(raw.trim() === "" ? {} : parseBody(raw));
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

/**
 * HTTP status for a `ProductivityError` reason. Anything not named here is bad
 * input: the service rejected a value, not the caller's rights.
 *
 * `not_found` is 404 and says nothing about whether a row exists — ownership
 * scoping is part of the query, so an other-user id and a nonexistent id fail
 * identically. `version_conflict` and the `duplicate_*` reasons are 409: the
 * request is well-formed and the state it assumed is gone.
 */
export function productivityStatus(reason: ProductivityErrorReason): number {
  if (reason === "not_found") return 404;
  if (reason === "not_authorized") return 403;
  if (reason === "version_conflict" || reason.startsWith("duplicate_")) return 409;
  return 400;
}

export function apiErrorResponse(error: unknown): Response {
  if (error instanceof ApiInputError) {
    return Response.json(
      { error: error.code },
      { status: error.code === "invalid_origin" ? 403 : 400 },
    );
  }
  // The Phase 0 actions wrap every call in `runAction`, which turns an
  // `AuthorizationError` into an `ActionError`; the 2C services are called
  // directly instead, so rbac's own denial has to reach the wire here. Without
  // this branch a `read_only` account posting an event would get 500 internal_error
  // rather than a 403 naming the missing grant.
  if (error instanceof AuthorizationError) {
    // A session that no longer matches the re-read account is the caller's to
    // re-establish (401); every other reason is a grant the role simply does not
    // have (403). The reason is the machine code; the message stays server-side.
    return Response.json(
      { error: error.reason },
      { status: error.reason === "stale_session" ? 401 : 403 },
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
  if (error instanceof ProductivityError) {
    // The reason is a stable machine code; the human message stays out of the
    // response so a service message cannot leak an internal value or path.
    return Response.json(
      { error: error.reason },
      {
        status: productivityStatus(error.reason),
      },
    );
  }
  return Response.json({ error: "internal_error" }, { status: 500 });
}
