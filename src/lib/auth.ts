import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { admin, role, twoFactor } from "better-auth/plugins";
import { getDb } from "@/db/client";
import { accounts, rate_limit, sessions, two_factor, users, verifications } from "@/db/schema";
import { recordAudit } from "./audit";
import { getConfig, getEnv } from "./env";
import { getLogger } from "./log";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, passwordHasher } from "./passwords";
import { redact } from "./redact";
import { backupCodeStore } from "./secretStore";

/**
 * Better Auth configuration (work items 1.1, 1.2, 1.4, 1.5, 1.6).
 *
 * The documented decision this file encodes (see docs/adr/0001): Better Auth's
 * HTTP endpoints under `/api/auth/*` are the only auth protocol surface the
 * browser uses. Server Actions call the same instance through `auth.api.*`
 * instead of issuing HTTP requests to ourselves — same protocol, same session
 * handling, no second implementation. Spec §12 says "no custom auth protocols";
 * this honors it because nothing here defines a credential or session format.
 *
 * Table and column names are pinned to the project's own snake_case schema
 * (spec §13) via model-name overrides, so Better Auth never creates tables and
 * its startup schema check either accepts our mapping or refuses to serve.
 */

/**
 * Better Auth's own access-control statements. The admin plugin refuses role
 * names it does not know ("Invalid admin roles: super_admin …"), so the four
 * roles must be declared here.
 *
 * They are intentionally coarse: this project never calls Better Auth's
 * `hasPermission` API. Every authorization decision goes through `authorize()`
 * in `src/lib/rbac.ts`, which reads the seeded matrix from the database. Keeping
 * two fine-grained systems would be a footgun, so only the coarse shape exists
 * on this side and it is documented as non-authoritative.
 */
/**
 * Better Auth's own admin-plugin vocabulary, copied from the measured defaults in
 * `better-auth/dist/plugins/admin/access/statement.mjs` (1.7.27). The plugin checks
 * these literal resource/action pairs inside its endpoints — `{ user: ["create"] }`,
 * `{ user: ["set-role"] }`, `{ session: ["revoke"] }` — so statements named after our
 * own app would simply deny every admin call.
 *
 * They are *not* this project's authorization model. The authoritative matrix lives
 * in `src/lib/rbac.ts` + the seeded `role_permissions` table and is checked first in
 * every action and route. Better Auth's check is a second gate, not a replacement.
 */
const BETTER_AUTH_ROLE_STATEMENTS = {
  super_admin: [
    "create",
    "list",
    "set-role",
    "ban",
    "impersonate",
    "impersonate-admins",
    "delete",
    "set-password",
    "set-email",
    "set-phone",
    "get",
    "update",
  ],
  admin: [
    "create",
    "list",
    "set-role",
    "ban",
    "impersonate",
    "delete",
    "set-password",
    "set-email",
    "set-phone",
    "get",
    "update",
  ],
  user: [],
  read_only: [],
} as const;

const BETTER_AUTH_SESSION_STATEMENTS = {
  super_admin: ["list", "revoke", "delete"],
  admin: ["list", "revoke", "delete"],
  user: [],
  read_only: [],
} as const;

function betterAuthRole(roleKey: keyof typeof BETTER_AUTH_ROLE_STATEMENTS) {
  return role({
    user: [...BETTER_AUTH_ROLE_STATEMENTS[roleKey]],
    session: [...BETTER_AUTH_SESSION_STATEMENTS[roleKey]],
  });
}

const log = getLogger("auth");

function buildAuth() {
  const config = getConfig();
  const env = getEnv();
  const auth = config.auth;

  return betterAuth({
    appName: "Personal Management Dashboard",
    baseURL: config.appUrl,
    basePath: "/api/auth",
    secret: env.sessionSecret,
    trustedOrigins: [config.appUrl],

    database: drizzleAdapter(getDb(), {
      provider: "sqlite",
      schema: {
        users,
        sessions,
        accounts,
        verifications,
        two_factor,
        rate_limit,
      },
    }),

    user: {
      modelName: "users",
      // Declared so Better Auth treats these columns as part of the user model.
      additionalFields: {
        mustChangePassword: { type: "boolean", required: false, input: false },
        onedriveLinked: { type: "boolean", required: false, input: false },
      },
    },
    session: {
      modelName: "sessions",
      expiresIn: auth.session.expiresInSec,
      updateAge: auth.session.updateAgeSec,
      freshAge: auth.session.freshAgeSec,
      // No cookie cache: spec §12 requires revocation to take effect immediately,
      // and a cached cookie is exactly what would delay it.
      cookieCache: { enabled: false },
    },
    account: { modelName: "accounts" },
    verification: { modelName: "verifications" },

    emailAndPassword: {
      enabled: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      maxPasswordLength: MAX_PASSWORD_LENGTH,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
      // Spec §12 requires Argon2id; Better Auth's default is scrypt. The hooks
      // must sit under `password` — measured from better-auth's create-context:
      // `options.emailAndPassword?.password?.hash || hashPassword`. Placing them
      // directly on emailAndPassword leaves scrypt in force with no warning, so
      // the hash format is asserted in tests/integration/authSpike.test.ts.
      password: {
        hash: async (password: string) => passwordHasher.hash(password),
        // Better Auth calls verify({ hash, password }); the hasher takes named
        // fields so the pair cannot be swapped. A swapped pair stores valid
        // hashes and rejects every login, which is exactly what the first spike
        // measured before this was fixed.
        verify: async ({ password, hash }: { password: string; hash: string }) =>
          passwordHasher.verify({ candidate: password, storedHash: hash }),
      },
    },

    rateLimit: {
      enabled: true,
      // Persisted in SQLite: restarting the process must not clear a brute-force
      // counter (spec §12 rate limiting).
      storage: "database",
      modelName: "rate_limit",
      window: auth.rateLimit.windowSec,
      max: auth.rateLimit.maxRequests,
      customRules: {
        "/sign-in/email": {
          window: auth.rateLimit.loginWindowSec,
          max: auth.rateLimit.loginMaxAttempts,
        },
        "/two-factor/verify-totp": {
          window: auth.rateLimit.loginWindowSec,
          max: auth.rateLimit.loginMaxAttempts,
        },
        "/two-factor/verify-backup-code": {
          window: auth.rateLimit.loginWindowSec,
          max: auth.rateLimit.loginMaxAttempts,
        },
      },
    },

    advanced: {
      cookiePrefix: "pmd",
      defaultCookiePrefix: "pmd",
      crossSiteCookies: false,
    },

    plugins: [
      admin({
        defaultRole: "read_only",
        adminRoles: ["admin", "super_admin"],
        roles: {
          super_admin: betterAuthRole("super_admin"),
          admin: betterAuthRole("admin"),
          user: betterAuthRole("user"),
          read_only: betterAuthRole("read_only"),
        },
        impersonationSessionDuration: 3600,
        bannedUserMessage: "This account is blocked.",
      }),
      twoFactor({
        twoFactorTable: "two_factor",
        issuer: auth.twoFactor.issuer,
        accountLockout: {
          enabled: true,
          maxFailedAttempts: auth.twoFactor.maxFailedAttempts,
          duration: auth.twoFactor.lockoutSeconds,
        },
        backupCodes: {
          amount: 10,
          length: 10,
          // Better Auth's default stores backup codes as plain JSON. Spec §12
          // requires recovery codes stored securely, so they use the same
          // AES-GCM key store as every other secret in this project.
          storeBackupCodes: backupCodeStore,
        },
      }),
      /**
       * Measured requirement: when Better Auth is called from a Server Action (an
       * admin creating an account, changing a password) its Set-Cookie headers must
       * go through Next's cookie store, otherwise the browser never receives them.
       * Better Auth warns if this plugin is not last.
       */
      nextCookies(),
    ],

    databaseHooks: {
      session: {
        create: {
          after: async (session) => {
            recordAudit({
              action: "sign_in",
              outcome: "success",
              actorUserId: session.userId,
              sessionId: session.id,
              targetKind: "session",
              targetId: session.id,
            });
          },
        },
        delete: {
          after: async (session) => {
            recordAudit({
              action: "session_revoked",
              outcome: "success",
              actorUserId: session.userId,
              sessionId: session.id,
              targetKind: "session",
              targetId: session.id,
            });
          },
        },
      },
      user: {
        create: {
          after: async (user) => {
            recordAudit({
              action: "account_created",
              outcome: "success",
              actorUserId: user.id,
              targetUserId: user.id,
              targetKind: "user",
              targetId: user.id,
              detail: { role: user.role },
            });
          },
        },
        update: {
          after: async (user) => {
            recordAudit({
              action: "account_updated",
              outcome: "success",
              actorUserId: user.id,
              targetUserId: user.id,
              targetKind: "user",
              targetId: user.id,
              detail: { role: user.role, banned: user.banned },
            });
          },
        },
      },
    },

    logLevel: config.logLevel === "debug" ? "debug" : "info",
    onLog: (level: "debug" | "info" | "warn" | "error", message: string, attributes?: unknown) => {
      // Better Auth can log request attributes; nothing credential-shaped is
      // allowed to reach the log (spec §14).
      const safe = redact({ ...(attributes ?? {}) }) as Record<string, unknown>;
      if (level === "warn" || level === "error") log.error(message, safe);
      else if (level === "debug") log.debug(message, safe);
      else log.info(message, safe);
    },
  });
}

let instance: ReturnType<typeof buildAuth> | null = null;

export function getAuth() {
  if (!instance) instance = buildAuth();
  return instance;
}

/**
 * Drops the cached instance. Needed by tests (each test gets its own SQLite file,
 * so the instance must be rebuilt against the new connection) and by CLI tools
 * that reconfigure the environment.
 */
export function resetAuthInstance(): void {
  instance = null;
}

export type AuthInstance = ReturnType<typeof getAuth>;
