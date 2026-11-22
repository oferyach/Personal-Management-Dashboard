import { ZodError } from "zod";
import { isProduction } from "@/lib/runtime";

/** Consistent error envelope (spec §14). Never leaks stack traces or internals. */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const API_ERRORS = {
  badRequest: (message = "Invalid request", details?: unknown) =>
    new ApiError(400, "bad_request", message, details),
  unauthorized: (message = "Authentication required") => new ApiError(401, "unauthorized", message),
  forbidden: (message = "You are not allowed to perform this action") =>
    new ApiError(403, "forbidden", message),
  notFound: (message = "Resource not found") => new ApiError(404, "not_found", message),
  conflict: (message = "Conflict with current state", details?: unknown) =>
    new ApiError(409, "conflict", message, details),
  tooManyRequests: (message = "Too many requests, try again later") =>
    new ApiError(429, "too_many_requests", message),
  internal: (message = "Unexpected error") => new ApiError(500, "internal_error", message),
} as const;

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { "Content-Type": "application/json; charset=utf-8", ...(init?.headers ?? {}) },
  });
}

export function errorResponse(error: unknown, requestId = newRequestId()): Response {
  if (error instanceof ApiError) {
    return json({
      error: { code: error.code, message: error.message, requestId },
      details: error.details,
    });
  }

  if (error instanceof ZodError) {
    return json({
      error: { code: "validation_error", message: "Validation failed", requestId },
      details: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  // Unknown error: log it server-side, tell the client nothing useful (spec §19).
  console.error("unhandled_api_error", { requestId, error });
  return json({
    error: {
      code: "internal_error",
      message: isProduction() ? "Unexpected error" : String((error as Error)?.message ?? error),
      requestId,
    },
  });
}
