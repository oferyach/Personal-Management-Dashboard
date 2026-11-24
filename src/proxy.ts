import { NextResponse, type NextRequest } from "next/server";
import { buildCsp, randomNonce } from "@/lib/csp";

/**
 * Per-request CSP enforcement (Next 16 "proxy" convention, replaces the
 * deprecated "middleware" convention). Phase 1 adds the session guard here
 * (docs/PLAN.md §1.4).
 */

const isProduction = process.env.NODE_ENV === "production";
const httpsAppUrl = (process.env.APP_URL ?? "").startsWith("https://");

export function proxy(request: NextRequest): NextResponse {
  const nonce = randomNonce();
  const csp = buildCsp(nonce, {
    production: isProduction,
    host: request.nextUrl.host,
    httpsUrl: httpsAppUrl,
  });

  // Next reads the CSP from the *request* headers to decide which inline
  // scripts may carry the nonce.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", csp);
  requestHeaders.set("x-nonce", nonce);
  // Server components cannot read the current path. The shell needs it to mark the
  // active destination, so the path is handed over as a request header.
  requestHeaders.set("x-pathname", request.nextUrl.pathname);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  response.headers.set("X-Nonce", nonce);
  return response;
}

export const config = {
  // Build assets and optimized images are not documents; everything user-facing
  // (pages and /api routes) goes through the CSP path.
  matcher: ["/((?!_next/static|_next/image).*)"],
};
