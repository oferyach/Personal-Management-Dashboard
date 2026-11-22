/**
 * Content-Security-Policy construction (spec §19).
 *
 * Kept in a pure module (no next/server import) so the policy itself is unit
 * testable, and so src/proxy.ts stays thin — Proxy runs outside the app runtime
 * and should not drag application modules along.
 *
 * Why a nonce at all: Next.js only attaches nonces to its own inline scripts
 * when the incoming request carries a CSP header containing `'nonce-<value>'`
 * (next/dist/server/app-render/get-script-nonce-from-header). A static CSP in
 * next.config cannot contain a per-request nonce, so `script-src 'self'` would
 * block Next's bootstrap scripts and the app would silently fail to hydrate.
 * The Phase 0 E2E test fails on any browser CSP violation, so this is measured.
 */

export interface CspOptions {
  production: boolean;
  /** request host (with port) used to allow the dev HMR websocket */
  host?: string;
  /** true when the app is really reached over HTTPS (APP_URL is an https origin) */
  httpsUrl?: boolean;
}

export function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  // btoa exists in Node and edge runtimes; Buffer is edge-ambiguous.
  return btoa(String.fromCharCode(...bytes));
}

export function buildCsp(nonce: string, options: CspOptions): string {
  const { production, host, httpsUrl } = options;
  const devHost = host ?? "localhost:4000";

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    // Next injects inline styles for font/preload handling. Tightening this is a
    // Phase 6 hardening item; loosening script-src is not an option.
    "style-src 'self' 'unsafe-inline'",
    production
      ? `script-src 'self' 'nonce-${nonce}'`
      : `script-src 'self' 'unsafe-eval' 'unsafe-inline' 'nonce-${nonce}'`,
    production
      ? "connect-src 'self'"
      : `connect-src 'self' ws://${devHost} wss://${devHost} http://${devHost} https://${devHost}`,
    // Only meaningful when TLS really terminates at the reverse proxy (spec §20).
    ...(production && httpsUrl ? ["upgrade-insecure-requests"] : []),
  ];

  return directives.join("; ");
}
