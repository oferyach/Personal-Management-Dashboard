import "server-only";

/**
 * One cast, in one place, for a measured better-auth 1.7.27 typing gap.
 *
 * Several endpoints validate a JSON body at runtime while their generated type says
 * the context has no body — `disableTwoFactor`, `revokeSessions`, `revokeUserSessions`
 * and `generateBackupCodes` all answer `400 [body] Invalid input: expected object,
 * received undefined` when called with headers only (measured in
 * `scripts/.probe-admin-api.mts`, and pinned by `tests/integration/securityActions.test.ts`).
 *
 * Rather than scattering `as any` across the services, every such call goes through
 * `asBodyCall` below. On a library upgrade the two integration tests either pass or
 * this helper becomes unnecessary — either way the mismatch is visible instead of
 * hidden.
 */
export type BodyCall<TResult = unknown> = (context: {
  headers: Headers;
  body?: Record<string, unknown>;
}) => Promise<TResult>;

export function asBodyCall<TResult = unknown>(endpoint: unknown): BodyCall<TResult> {
  return endpoint as BodyCall<TResult>;
}

/**
 * Cookie rotation, measured in `scripts/.probe-cookie-rotation.mts`:
 *
 *  - `/two-factor/disable` with the account password answers 200 **and sets a new
 *    `pmd.session_token`** — the old cookie stops working immediately.
 *  - `/revoke-sessions` answers 200 and sets `pmd.session_token=`, `pmd.session_data=`
 *    and `pmd.dont_remember=` with empty values (a sign-out).
 *  - `/two-factor/enable` and `/change-password` answer 200 and set nothing.
 *
 * So a Server Action that calls one of those endpoints and ignores the response
 * headers leaves the browser holding a dead cookie: the next page load bounces to
 * `/login` with no explanation. Asking Better Auth for a `Response` (`asResponse`
 * measured to work on every endpoint tried) makes those headers visible, and this
 * helper hands them to the caller, which writes them into the real response.
 */

/** A failed Better Auth endpoint, shaped like its own APIError so the notice mapping works. */
export class AuthApiError extends Error {
  readonly status: number;
  readonly body: { code?: string; message?: string };
  constructor(status: number, body: { code?: string; message?: string }) {
    super(body.message ?? `auth endpoint answered ${status}`);
    this.name = "AuthApiError";
    this.status = status;
    this.body = body;
  }
}

export interface AuthApiCall {
  headers: Headers;
  body?: Record<string, unknown>;
  /** Called with every `Set-Cookie` the endpoint produced, before the body is returned. */
  adoptCookies?: (setCookies: readonly string[]) => void;
}

/**
 * Calls a Better Auth endpoint as the library intends (protocol, cookies, expiry all
 * stay inside Better Auth) and returns its decoded body.
 *
 * `endpoint` is typed `unknown` on purpose: the generated signatures disagree with
 * each other about `body` (see `asBodyCall` above), and one untyped boundary here is
 * what keeps the services free of casts.
 */
export async function callAuthApi<T = unknown>(endpoint: unknown, call: AuthApiCall): Promise<T> {
  const callable = endpoint as (input: Record<string, unknown>) => Promise<unknown>;
  const response = await callable({ ...call, asResponse: true });

  if (!(response instanceof Response)) {
    // No library in this project produces a non-Response here; if one ever does, the
    // body is still returned rather than silently dropped.
    return response as T;
  }

  const setCookies = response.headers.getSetCookie();
  if (call.adoptCookies && setCookies.length > 0) call.adoptCookies(setCookies);

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = { message: text.slice(0, 200) };
    }
  }

  if (!response.ok) {
    const body = (parsed ?? {}) as { code?: string; message?: string };
    throw new AuthApiError(response.status, body);
  }

  return parsed as T;
}
