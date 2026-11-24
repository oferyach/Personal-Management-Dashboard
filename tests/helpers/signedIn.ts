import { getAuth } from "@/lib/auth";
import { resolveSessionState } from "@/lib/sessions";
import { secretFromTotpUri, totpCode } from "./totp";
import type { ActionContext } from "@/lib/requestAuth";

/**
 * A signed-in request, built the way a browser builds one.
 *
 * Everything a Server Action needs is a `Headers` object carrying Better Auth's own
 * cookies, so the tests drive the same path production uses: Better Auth's handler
 * issues the cookies, the service layer reads them. No test hand-writes a session row
 * and pretends a page can see it — that is exactly the assumption that hid the
 * signed-cookie bug (the cookie is `<token>.<signature>`, not the token).
 */

const BASE = "http://127.0.0.1:4000";

export interface AuthCallResult {
  status: number;
  json: Record<string, unknown> | null;
  text: string;
  cookie: string;
  setCookies: string[];
}

export async function authCall(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<AuthCallResult> {
  const headers: Record<string, string> = {
    origin: BASE,
    "content-type": "application/json",
  };
  if (options.cookie) headers.cookie = options.cookie;

  const res = await getAuth().handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );

  const text = await res.text();
  let json: Record<string, unknown> | null = null;
  try {
    json = text ? (JSON.parse(text) as Record<string, unknown>) : null;
  } catch {
    json = null;
  }

  const setCookies = res.headers.getSetCookie().map((entry) => entry.split(";").at(0) ?? "");
  return { status: res.status, json, text, cookie: setCookies.join("; "), setCookies };
}

/** Only the cookies Better Auth owns; a stale one from a previous call is not carried over. */
function ownedCookies(result: AuthCallResult, names: string[]): string {
  return result.setCookies
    .filter((entry) => names.some((name) => entry.startsWith(`${name}=`)))
    .join("; ");
}

export interface SignInOptions {
  /** Set when the account has a second factor: the sign-in answers a challenge first. */
  totpSecret?: string;
}

/**
 * Signs in and returns the request headers a page or Server Action would carry.
 *
 * Measured behaviour (1.2 spike): once MFA is enabled, `/sign-in/email` answers
 * `{ twoFactorRedirect: true }`, clears the password session and sets a signed
 * `pmd.two_factor` challenge cookie. The session cookie only appears after the TOTP
 * step, so a test that wants an authenticated session must complete that step too.
 */
export async function signInHeaders(
  email: string,
  password: string,
  options: SignInOptions = {},
): Promise<Headers> {
  const first = await authCall("/sign-in/email", { body: { email, password } });
  if (first.status !== 200) throw new Error(`sign-in failed (${first.status}): ${first.text}`);

  if (first.json?.twoFactorRedirect === true) {
    if (!options.totpSecret)
      throw new Error(
        "this account now requires the second factor; pass options.totpSecret to sign in",
      );
    const challenge = ownedCookies(first, ["pmd.two_factor"]);
    const verified = await authCall("/two-factor/verify-totp", {
      body: { code: totpCode(options.totpSecret) },
      cookie: challenge,
    });
    if (verified.status !== 200)
      throw new Error(`second factor failed (${verified.status}): ${verified.text}`);
    return requestHeaders(ownedCookies(verified, ["pmd.session_token", "pmd.session_data"]));
  }

  return requestHeaders(ownedCookies(first, ["pmd.session_token", "pmd.session_data"]));
}

export function requestHeaders(cookie: string): Headers {
  if (!cookie.includes("pmd.session_token="))
    throw new Error(`no session cookie issued: ${JSON.stringify(cookie)}`);
  return new Headers({ cookie, origin: BASE });
}

/**
 * The `ActionContext` a Server Action would receive.
 *
 * `src/lib/requestAuth.ts` builds this from `next/headers`, which does not exist
 * outside a request; the shape it produces is built here from the same session
 * resolver those functions call, so the service layer is tested against the real
 * state a real request would carry.
 */
export async function actionContextFor(
  email: string,
  password: string,
  options: SignInOptions = {},
): Promise<ActionContext> {
  const headers = await signInHeaders(email, password, options);
  const state = await resolveSessionState(headers);
  if (state.kind === "anonymous") throw new Error("session resolved anonymous");
  return { user: state.user, state: state.kind, headers };
}

/** Reads the TOTP secret out of a pending enrollment Better Auth stored for this user. */
export function secretOfPendingEnrollment(totpURI: string): string {
  return secretFromTotpUri(totpURI);
}
