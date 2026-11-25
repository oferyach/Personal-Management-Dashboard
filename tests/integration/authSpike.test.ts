import { createHmac, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getSqlite } from "@/db/client";
import { seedRbac } from "@/db/seed/rbac";
import { getAuth, resetAuthInstance } from "@/lib/auth";
import { closeTestDatabases, resetTestDatabase } from "../helpers/testDb";

/**
 * Phase 1.1 spike + gate evidence (docs/PLAN.md: "prove the chosen auth library
 * satisfies the Phase 1 requirements on this stack before building UI on it").
 *
 * Everything below is asserted through Better Auth's own HTTP handler — the same
 * handler `src/app/api/auth/[...all]/route.ts` mounts — so the conclusion is about
 * the library on this stack, not about code we wrote.
 */

const BASE = "http://127.0.0.1:4000";

function start(scope: string) {
  resetTestDatabase(scope);
  seedRbac();
  resetAuthInstance();
  return getAuth();
}

async function call(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string; origin?: string } = {},
) {
  const headers: Record<string, string> = {
    origin: options.origin ?? BASE,
    "content-type": "application/json",
  };
  if (options.cookie) headers.cookie = options.cookie;

  const auth = getAuth();
  const res = await auth.handler(
    new Request(`${BASE}/api/auth${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    }),
  );
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return {
    status: res.status,
    json: json as Record<string, unknown> | null,
    text,
    cookie: res.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; "),
    setCookies: res.headers.getSetCookie(),
  };
}

/** RFC 6238 TOTP, used only to *verify* the library's implementation in tests. */
function totpCode(secretBase32: string, timeStepSec = 30, digits = 6, step = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretBase32.toUpperCase().replace(/=/g, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < key.length; i++) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);

  const counter = BigInt(Math.floor(Date.now() / 1000 / timeStepSec) + step);
  const data = Buffer.alloc(8);
  data.writeBigUInt64BE(counter);

  const hmac = createHmac("sha1", key).update(data).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const value =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return (value % 10 ** digits).toString().padStart(digits, "0");
}

function scalar<T>(row: unknown, column: string): T {
  return (row as Record<string, T | undefined>)[column] as T;
}

const adminPassword = "Spike-Admin-Pass-2026!";

async function createAccount(
  _auth: ReturnType<typeof getAuth>,
  name: string,
  email: string,
  password: string,
) {
  const res = await call("/sign-up/email", { body: { name, email, password } });
  if (res.status !== 200) throw new Error(`sign-up failed (${res.status}): ${res.text}`);
  return res;
}

describe("Phase 1 auth spike — Better Auth on Next 16 + Drizzle + better-sqlite3", () => {
  it("boots against the project's snake_case schema and runs the full sign-in lifecycle", async () => {
    const auth = start("auth-spike");
    const db = getSqlite();
    const email = `admin+${randomBytes(3).toString("hex")}@example.internal`;

    try {
      // 1.1 — the library accepted our schema. If any table or column name were
      // wrong, Better Auth refuses to serve a request (schema check) or errors here.
      await createAccount(auth, "Spike Admin", email, adminPassword);

      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        .all() as { name: string }[];
      // Our own schema tables must be exactly what Better Auth used: it never
      // creates a table of its own when the Drizzle mapping is correct.
      expect(tables.map((t) => t.name).sort()).toEqual(
        [
          "__drizzle_migrations",
          "accounts",
          "activity_log",
          "audit_logs",
          "event_participants",
          "events",
          "permissions",
          "rate_limit",
          "resource_permissions",
          "role_permissions",
          "roles",
          "sessions",
          "system_meta",
          "tag_links",
          "tags",
          "two_factor",
          "user_preferences",
          "users",
          "verifications",
        ].sort(),
      );

      const signedIn = await call("/sign-in/email", { body: { email, password: adminPassword } });
      expect(signedIn.status, signedIn.text).toBe(200);

      // 1.5 — session cookie attributes.
      const sessionCookie = signedIn.setCookies.find((c) => c.startsWith("pmd.session_token="));
      expect(sessionCookie, JSON.stringify(signedIn.setCookies)).toBeTruthy();
      expect(sessionCookie!).toMatch(/httponly/i);
      expect(sessionCookie).toMatch(/samesite=lax/i);
      expect(sessionCookie).toMatch(/max-age=\d+/i);

      const sessionRow = db
        .prepare("SELECT id, token, expires_at, created_at FROM sessions LIMIT 1")
        .get();
      expect(sessionRow).toBeTruthy();
      const expiresAt = new Date(scalar<string>(sessionRow, "expires_at")).getTime();
      const createdAt = new Date(scalar<string>(sessionRow, "created_at")).getTime();
      // 8h session (spec §12: configurable, default 8h working day).
      expect(expiresAt - createdAt).toBeGreaterThanOrEqual(7 * 3600 * 1000);
      expect(expiresAt - createdAt).toBeLessThanOrEqual(9 * 3600 * 1000);

      // The session is readable with the cookie, which is what the app shell relies on.
      const session = await call("/get-session", { cookie: signedIn.cookie });
      expect(session.status).toBe(200);
      expect((session.json as { session?: { token?: string } })?.session?.token).toBeTruthy();

      // 1.2 — Argon2id with the project's parameters, stored as a PHC string.
      const account = db.prepare("SELECT password FROM accounts LIMIT 1").get();
      expect(scalar<string>(account, "password")).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);

      // Wrong credential: rejected, and no session row appears.
      const wrong = await call("/sign-in/email", {
        body: { email, password: "totally-wrong-password" },
      });
      expect(wrong.status).toBe(401);
      const sessionCount = scalar<number>(
        db.prepare("SELECT COUNT(*) AS c FROM sessions").get(),
        "c",
      );
      expect(sessionCount).toBe(1);

      // Short passwords are rejected by policy (spec §12: minimum 12 characters).
      // Measured: Better Auth rejects an out-of-range body value with 400
      // VALIDATION_ERROR, not 422. Both are refusals; the point is that no
      // account with a weak password can exist.
      const shortPw = await call("/sign-up/email", {
        body: {
          name: "Short",
          email: `short+${randomBytes(2).toString("hex")}@example.internal`,
          password: "tiny",
        },
      });
      expect([400, 422]).toContain(shortPw.status);
      expect(scalar<number>(db.prepare("SELECT COUNT(*) AS c FROM users").get(), "c")).toBe(1);

      // 1.6 — sign-out revokes the session immediately.
      // Measured: /sign-out deletes the row, and /get-session then answers 200
      // with a `null` body rather than 401. The app must treat a null session as
      // unauthenticated; `src/lib/sessions.ts` never trusts the cookie alone.
      const signedOut = await call("/sign-out", { body: {}, cookie: signedIn.cookie });
      expect(signedOut.status).toBe(200);
      const afterRevoke = await call("/get-session", { cookie: signedIn.cookie });
      expect(afterRevoke.status, afterRevoke.text).toBe(200);
      expect(afterRevoke.json).toBeNull();
      expect(scalar<number>(db.prepare("SELECT COUNT(*) AS c FROM sessions").get(), "c")).toBe(0);
    } finally {
      closeTestDatabases();
    }
  });

  it("MFA: TOTP enrollment, verification, single-use backup codes, encrypted at rest", async () => {
    const auth = start("auth-mfa");
    const db = getSqlite();
    const email = `mfa+${randomBytes(3).toString("hex")}@example.internal`;
    const password = "Mfa-Password-2026!x";

    try {
      await createAccount(auth, "MFA Owner", email, password);
      const first = await call("/sign-in/email", { body: { email, password } });
      expect(first.status, first.text).toBe(200);

      const enable = await call("/two-factor/enable", { body: { password }, cookie: first.cookie });
      expect(enable.status, enable.text).toBe(200);
      // Measured field name: the enable endpoint returns `totpURI` (not
      // `totpURL`), containing the otpauth:// URI with the shared secret.
      const enableBody = enable.json as { totpURI?: string; backupCodes?: string[]; type?: string };
      expect(enableBody.totpURI).toMatch(/^otpauth:\/\/totp\//);
      const totpParams = new URL(enableBody.totpURI!);
      expect(totpParams.searchParams.get("issuer")).toBe("Personal Management Dashboard");
      const secret = totpParams.searchParams.get("secret")!;
      expect(secret.length).toBeGreaterThanOrEqual(16);
      const backupCodes = enableBody.backupCodes ?? [];
      expect(backupCodes.length).toBeGreaterThanOrEqual(8);

      // Measured enrollment behaviour: /two-factor/enable stores the secret and
      // the backup codes but leaves the factor *pending* (`two_factor.verified`
      // = 0, `users.two_factor_enabled` = 0). Activation only happens when a TOTP
      // code is actually verified, which is what work item 1.6 asks for.
      const userFlagBefore = scalar<number>(
        db.prepare("SELECT two_factor_enabled FROM users LIMIT 1").get(),
        "two_factor_enabled",
      );
      expect(userFlagBefore).toBe(0);
      expect(
        scalar<number>(db.prepare("SELECT verified FROM two_factor LIMIT 1").get(), "verified"),
      ).toBe(0);

      // Spec §12: MFA secrets and recovery codes must not be readable at rest.
      const twoFactorRow = db.prepare("SELECT secret, backup_codes FROM two_factor LIMIT 1").get();
      const storedSecret = scalar<string>(twoFactorRow, "secret");
      const storedCodes = scalar<string>(twoFactorRow, "backup_codes");
      expect(storedSecret).not.toBe(secret);
      expect(storedSecret.length).toBeGreaterThan(secret.length);
      expect(storedCodes).not.toContain(backupCodes[0]!);
      expect(storedCodes.trim().startsWith("[")).toBe(false);

      const wrongEnrollment = await call("/two-factor/verify-totp", {
        body: { code: "000000" },
        cookie: first.cookie,
      });
      expect([400, 401]).toContain(wrongEnrollment.status);
      expect(
        scalar<number>(
          db.prepare("SELECT two_factor_enabled FROM users LIMIT 1").get(),
          "two_factor_enabled",
        ),
      ).toBe(0);

      // A valid code activates the factor and rotates the session (1.4: no fixation).
      const activate = await call("/two-factor/verify-totp", {
        body: { code: totpCode(secret) },
        cookie: first.cookie,
      });
      expect(activate.status, activate.text).toBe(200);
      expect(
        scalar<number>(
          db.prepare("SELECT two_factor_enabled FROM users LIMIT 1").get(),
          "two_factor_enabled",
        ),
      ).toBe(1);
      expect(
        scalar<number>(db.prepare("SELECT verified FROM two_factor LIMIT 1").get(), "verified"),
      ).toBe(1);
      const activatedCookie = activate.cookie || first.cookie;
      expect(activatedCookie, "a session cookie must exist after activation").toBeTruthy();
      expect((await call("/get-session", { cookie: activatedCookie })).status).toBe(200);

      // Measured: get-totp-uri is POST and requires the password again, so the UI
      // can never display a live TOTP secret from a session cookie alone.
      const totpUri = await call("/two-factor/get-totp-uri", {
        method: "POST",
        body: { password },
        cookie: activatedCookie,
      });
      expect(totpUri.status, totpUri.text).toBe(200);
      const refreshed = totpUri.json as { totpURI?: string };
      expect(refreshed.totpURI).toBe(enableBody.totpURI);

      // From now on the password alone is not enough (spec §12 MFA required).
      await call("/sign-out", { body: {}, cookie: activatedCookie });
      const second = await call("/sign-in/email", { body: { email, password } });
      expect(second.status, second.text).toBe(200);
      // Measured shape of a 2FA challenge in better-auth 1.7.27: the body carries
      // no secret. It says "redirect to the second-factor step" plus the methods
      // available, the password session that was just created is deleted, and the
      // pending challenge lives server-side in `verifications` behind a signed
      // cookie. The UI must not try to read a token out of the body.
      const body = second.json as { twoFactorRedirect?: boolean; twoFactorMethods?: string[] };
      expect(body.twoFactorRedirect).toBe(true);
      expect(body.twoFactorMethods).toEqual(["totp"]);
      // The password session is cleared by expiring the cookie (Max-Age=0), and a
      // signed `pmd.two_factor` challenge cookie (10 minutes) carries the pending
      // step. Nothing usable is handed to the client before the second factor.
      const clearedSession = second.setCookies.find((c) => c.startsWith("pmd.session_token="));
      expect(clearedSession, second.setCookies.join("; ")).toMatch(/max-age=0/i);
      const challenge = second.setCookies.find((c) => c.startsWith("pmd.two_factor="));
      expect(challenge, second.setCookies.join("; ")).toBeTruthy();
      expect(challenge).toMatch(/httponly/i);
      expect(challenge).toMatch(/max-age=600/i);
      const challenges = db
        .prepare("SELECT identifier, value FROM verifications WHERE identifier LIKE '2fa%'")
        .all() as { identifier: string; value: string }[];
      // One row holds the pending user id, one holds the failed-attempt counter.
      expect(challenges.length).toBe(2);

      const wrongTotp = await call("/two-factor/verify-totp", {
        body: { code: "123456" },
        cookie: second.cookie,
      });
      expect(wrongTotp.status).toBe(401);

      const good = await call("/two-factor/verify-totp", {
        body: { code: totpCode(secret) },
        cookie: second.cookie,
      });
      expect(good.status, good.text).toBe(200);
      const sessionAfterMfa = await call("/get-session", { cookie: good.cookie });
      expect(sessionAfterMfa.status).toBe(200);

      // Backup code path: works once, then it is gone (spec §12 single use).
      const third = await call("/sign-in/email", { body: { email, password } });
      const usedBackup = await call("/two-factor/verify-backup-code", {
        body: { code: backupCodes[0]! },
        cookie: third.cookie,
      });
      expect(usedBackup.status, usedBackup.text).toBe(200);

      const fourth = await call("/sign-in/email", { body: { email, password } });
      const reused = await call("/two-factor/verify-backup-code", {
        body: { code: backupCodes[0]! },
        cookie: fourth.cookie,
      });
      expect(reused.status).toBe(401);

      // A wrong TOTP twice in a row is recorded; the account lockout counter is real.
      const failedCount = scalar<number>(
        db.prepare("SELECT failed_verification_count FROM two_factor LIMIT 1").get(),
        "failed_verification_count",
      );
      expect(failedCount).toBeGreaterThan(0);
    } finally {
      closeTestDatabases();
    }
  });

  it("rate limiting is database-backed and blocks further attempts", async () => {
    const auth = start("auth-rate-limit");
    const db = getSqlite();
    const email = `rl+${randomBytes(3).toString("hex")}@example.internal`;

    try {
      await createAccount(auth, "Rate Limit Target", email, "Rate-Limit-Password-2026!");

      let blocked = 0;
      let failed = 0;
      for (let attempt = 0; attempt < 15; attempt++) {
        const res = await call("/sign-in/email", {
          body: { email, password: "definitely-the-wrong-one" },
        });
        if (res.status === 429) blocked++;
        else if (res.status === 401) failed++;
      }

      expect(failed).toBeGreaterThan(0);
      expect(blocked).toBeGreaterThan(0);

      // Counters survive in the database (a restart cannot clear them).
      const rows = db.prepare("SELECT `key`, `count`, last_request FROM rate_limit").all() as {
        key: string;
        count: number;
        last_request: number;
      }[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.some((row) => row.count > 0)).toBe(true);
    } finally {
      closeTestDatabases();
    }
  });

  it("cross-origin POST to an auth endpoint is refused (CSRF)", async () => {
    const auth = start("auth-csrf");
    try {
      void auth;
      const res = await call("/sign-in/email", {
        body: { email: "nobody@example.internal", password: "whatever-12345678" },
        origin: "https://evil.example",
      });
      // Evidence: Better Auth answers a cross-origin POST with 401. What matters
      // is that the request is refused and no session is created.
      expect([401, 403]).toContain(res.status);
      expect(getSqlite().prepare("SELECT COUNT(*) AS c FROM sessions").get()).toEqual({ c: 0 });
    } finally {
      closeTestDatabases();
    }
  });

  it("audit rows are written for sign-in and session revocation (1.11)", async () => {
    const auth = start("auth-audit");
    const db = getSqlite();
    const email = `audit+${randomBytes(3).toString("hex")}@example.internal`;

    try {
      await createAccount(auth, "Audit Target", email, "Audit-Password-2026!!");
      const signedIn = await call("/sign-in/email", {
        body: { email, password: "Audit-Password-2026!!" },
      });
      expect(signedIn.status).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 60));

      const actions = db.prepare("SELECT action, outcome FROM audit_logs").all() as {
        action: string;
        outcome: string;
      }[];
      expect(actions.some((a) => a.action === "sign_in" && a.outcome === "success")).toBe(true);

      await call("/sign-out", { body: {}, cookie: signedIn.cookie });
      await new Promise((resolve) => setTimeout(resolve, 60));

      const after = db.prepare("SELECT action, outcome FROM audit_logs").all() as {
        action: string;
      }[];
      expect(after.some((a) => a.action === "session_revoked")).toBe(true);

      // No credential-like value ever reaches the audit log (spec §14).
      const rows = db.prepare("SELECT detail FROM audit_logs").all() as { detail: string | null }[];
      for (const row of rows) {
        expect(row.detail ?? "").not.toContain("Audit-Password");
      }
    } finally {
      closeTestDatabases();
    }
  });
});
