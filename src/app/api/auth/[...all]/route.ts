import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth";

/**
 * Work item 1.1 / 1.2 — the Better Auth protocol surface.
 *
 * Every auth request the browser makes (`/api/auth/sign-in/email`,
 * `/api/auth/two-factor/verify-totp`, `/api/auth/sign-out`, the admin endpoints)
 * lands here. One library, one protocol, one session format: the app never
 * implements its own password or TOTP comparison.
 *
 * `getAuth()` is resolved per request, not at module load. Measured reason:
 * `next build` collects route metadata with NODE_ENV=production and no secrets in
 * the environment, so an eager `getAuth()` here aborts the build on the production
 * secret check ("SESSION_SECRET is required in production") before any artifact is
 * produced. `getAuth()` caches, so the first real request builds the instance and a
 * broken configuration still fails loudly at that request; the startup gate itself
 * lives in src/instrumentation.ts + src/lib/serverStart.ts, which run before any
 * request is served.
 */
export const { GET, POST, PUT, PATCH, DELETE } = toNextJsHandler((request) =>
  getAuth().handler(request),
);
