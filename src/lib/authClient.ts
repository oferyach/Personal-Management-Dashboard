"use client";

import { createAuthClient } from "better-auth/react";
import { adminClient, twoFactorClient } from "better-auth/client/plugins";

/**
 * The browser half of Better Auth (1.1/1.2). It exists so the UI talks to the same
 * endpoints the spike proved (`/api/auth/*`) instead of hand-rolling fetch calls and
 * hoping the cookie names stay correct.
 *
 * `baseURL` is deliberately NOT set, and must never be set to something like "/".
 * Measured in better-auth 1.7.27 (`dist/client/config.mjs` + `dist/utils/url.mjs`):
 * omitting it resolves to the relative `/api/auth`, which the browser resolves
 * against the current origin — exactly what this app wants, because the deployment
 * host is not baked into the bundle. Passing `"/"` instead runs Better Auth's
 * `assertHasProtocol()` during module evaluation, which throws
 * `BetterAuthError: Invalid base URL: /` while the login page is still being
 * server-rendered, i.e. a 500 on the one page every user lands on.
 */
export const authClient = createAuthClient({
  basePath: "/api/auth",
  plugins: [twoFactorClient(), adminClient()],
});

export const { signOut } = authClient;

/**
 * The fields this app adds to `users` (work item 1.7). Better Auth returns them; the
 * UI reads them through this narrow type instead of `any`.
 */
export interface AuthenticatedClientUser {
  id: string;
  name: string | null;
  email: string;
  emailVerified: boolean;
  role: string;
  banned: boolean;
  twoFactorEnabled: boolean;
  mustChangePassword: boolean;
  onedriveLinked: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TwoFactorChallenge {
  twoFactorRedirect?: boolean;
  twoFactorMethods?: string[];
}
