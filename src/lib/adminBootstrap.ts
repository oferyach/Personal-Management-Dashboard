import { count, eq } from "drizzle-orm";

import { getDb } from "@/db/client";
import { users } from "@/db/schema";
import type { RoleKey } from "@/db/schema/identity";
import { recordAudit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { getLogger } from "@/lib/log";
import { validatePasswordStrength } from "@/lib/passwords";
import { ROLE_KEYS, activePrivilegedAccountCount, isPrivilegedRole, isRoleKey } from "@/lib/rbac";

/**
 * First-admin bootstrap (work item 1.3).
 *
 * An install starts with zero accounts, so no permission check can create the first
 * one: there is no actor yet. This is the only place in the project that creates an
 * account without a preceding authorization decision, and the reasons are recorded
 * here rather than hidden:
 *
 *  - The credential is created by Better Auth's own `/sign-up/email` endpoint, so the
 *    Argon2id hashing, the `accounts` row and the user row all follow the library's
 *    protocol (docs/adr/0001). Nothing here hashes a password by hand.
 *  - The role is then written into `users.role` directly. `auth.api.setRole` needs an
 *    existing privileged session, and by definition none exists yet; `users.role` is a
 *    column of this project (a key into the seeded `roles` table), not a Better Auth
 *    secret. Writing it is the only way to bootstrap, and the write is audited.
 *  - `must_change_password` is cleared because the operator typed this password
 *    themselves. The flag exists for passwords an administrator typed on someone
 *    else's behalf (1.7).
 *  - No default or well-known credential exists anywhere: the CLI has no built-in
 *    password, and it reads one from a prompt (or `--password-stdin`), never from an
 *    argument that would appear in a shell history or a process list.
 *
 * After the first privileged account exists, this CLI refuses to create another
 * privileged account unless `--force --confirm` are both given.  However, once the
 * first admin exists the CLI is also the only provisioning path available before the
 * web UI is reachable, so it must also create *non-privileged* accounts (e.g. the
 * E2E observer) without requiring `--force`.  Those accounts go through the same
 * code path and receive `must_change_password = true` so the user is redirected to
 * the security screen to set their own password immediately.
 */

const log = getLogger("admin-bootstrap");

export type BootstrapRefusal =
  | "admin_exists"
  | "confirmation_required"
  | "invalid_name"
  | "invalid_email"
  | "weak_password"
  | "email_taken"
  | "role_not_privileged"
  | "invalid_role";

export class AdminBootstrapError extends Error {
  readonly reason: BootstrapRefusal;
  constructor(reason: BootstrapRefusal, message: string) {
    super(message);
    this.name = "AdminBootstrapError";
    this.reason = reason;
  }
}

export interface FirstAdminInput {
  name: string;
  email: string;
  password: string;
  /** Defaults to `super_admin`; privileged roles force first-admin semantics. */
  role?: RoleKey;
  force?: boolean;
  confirm?: boolean;
}

export interface BootstrapState {
  accounts: number;
  privilegedAccounts: number;
  /** True when the install has accounts but nobody who can administer it (1.3 guard). */
  privilegedMissing: boolean;
}

export function bootstrapState(): BootstrapState {
  const accounts = getDb().select({ c: count() }).from(users).get()?.c ?? 0;
  const privilegedAccounts = activePrivilegedAccountCount();
  return {
    accounts,
    privilegedAccounts,
    privilegedMissing: accounts > 0 && privilegedAccounts === 0,
  };
}

export interface FirstAdminResult {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
  mustChangePassword: boolean;
  privilegedAccountsAfter: number;
}

/**
 * The invariants, checked before anything is written, so a refused bootstrap leaves
 * the database exactly as it was.
 */
function assertInput(input: FirstAdminInput): { name: string; email: string; role: RoleKey } {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  const role = input.role ?? "super_admin";

  if (name.length < 2 || name.length > 120)
    throw new AdminBootstrapError("invalid_name", "name must be 2–120 characters");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
    throw new AdminBootstrapError("invalid_email", "email is not a valid address");
  if (!isRoleKey(role))
    throw new AdminBootstrapError("invalid_role", `role is not one of: ${ROLE_KEYS.join(", ")}`);

  const problems = validatePasswordStrength(input.password);
  if (problems.length > 0)
    throw new AdminBootstrapError(
      "weak_password",
      `password rejected: ${problems.join(", ")} (minimum length 12)`,
    );

  return { name, email, role };
}

/**
 * Gate: should we let this account creation through?
 *
 * Three scenarios:
 * 1. No privileged accounts exist and the role is privileged → always allowed (first admin).
 * 2. No privileged accounts exist and the role is not privileged → allowed (pre-seeding a
 *    non-admin before the first admin; the account will have must_change_password=true).
 * 3. Privileged accounts already exist → non-privileged roles always allowed (E2E observer,
 *    test accounts, normal users created via CLI). Privileged roles require --force --confirm.
 */
function canCreate(
  existing: BootstrapState,
  role: RoleKey,
  force: boolean,
  confirm: boolean,
): true | AdminBootstrapError {
  const isPriv = isPrivilegedRole(role);

  // Scenario 1: first privileged account.
  if (existing.privilegedAccounts === 0 && isPriv) return true;

  // Scenario 2: non-privileged account before any admin exists.
  if (existing.privilegedAccounts === 0 && !isPriv) return true;

  // Scenario 3a: privileged account already exists, creating another privileged account.
  if (existing.privilegedAccounts > 0 && isPriv) {
    if (force && confirm) return true;
    throw new AdminBootstrapError(
      "admin_exists",
      `${existing.privilegedAccounts} privileged account(s) already exist. Create accounts in the users screen, or re-run with --force --confirm.`,
    );
  }

  // Scenario 3b: privileged account already exists, creating a non-privileged account.
  if (existing.privilegedAccounts > 0 && !isPriv) return true;

  return true;
}

export async function createFirstAdmin(input: FirstAdminInput): Promise<FirstAdminResult> {
  const { name, email, role } = assertInput(input);
  const existing = bootstrapState();

  const allow = canCreate(existing, role, !!input.force, !!input.confirm);
  if (allow instanceof AdminBootstrapError) throw allow;

  if (existing.privilegedAccounts > 0 && isPrivilegedRole(role) && input.force) {
    log.warn("bootstrap forced to create an additional privileged account", {
      privilegedAccountsBefore: existing.privilegedAccounts,
    });
  }

  const auth = getAuth();
  let created: unknown;
  try {
    created = await auth.api.signUpEmail({ body: { name, email, password: input.password } });
  } catch (error) {
    const code = (error as { body?: { code?: string } })?.body?.code;
    if (code === "USER_ALREADY_EXISTS" || code === "EMAIL_TAKEN")
      throw new AdminBootstrapError(
        "email_taken",
        `that email address is already in use (${code})`,
      );
    throw new AdminBootstrapError(
      "email_taken",
      `account creation failed${code ? ` (${code})` : ""}`,
    );
  }

  const createdUserId = (created as { user?: { id?: string } })?.user?.id;
  if (!createdUserId)
    throw new AdminBootstrapError("invalid_email", "creation returned no user id");

  // Non-first-admin (non-privileged) accounts get must_change_password=true
  // so they must visit the security screen on first login.
  const mustChangePw =
    existing.privilegedAccounts > 0 && !isPrivilegedRole(role)
      ? true
      : input.force === true && isPrivilegedRole(role)
        ? false
        : false;

  getDb()
    .update(users)
    .set({ role, mustChangePassword: mustChangePw, updatedAt: new Date().toISOString() })
    .where(eq(users.id, createdUserId))
    .run();

  recordAudit({
    action: "account_created",
    outcome: "success",
    actorUserId: createdUserId,
    targetUserId: createdUserId,
    targetKind: "account",
    targetId: createdUserId,
    detail: { role, via: "bootstrap_cli", forced: input.force === true },
  });

  const row = getDb().select().from(users).where(eq(users.id, createdUserId)).get();
  if (!row)
    throw new AdminBootstrapError("invalid_email", "created account could not be read back");

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: isRoleKey(row.role) ? row.role : "read_only",
    mustChangePassword: row.mustChangePassword,
    privilegedAccountsAfter: activePrivilegedAccountCount(),
  };
}
