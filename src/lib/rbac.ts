import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db/client";
import {
  permissions,
  resource_permissions,
  role_permissions,
  roles,
  user_preferences,
  users,
} from "@/db/schema";
import type { RoleKey } from "@/db/schema/identity";
import { getConfig } from "./env";
import { getLogger } from "./log";

/**
 * Authorization (Phase 1, work item 1.5 / spec §12).
 *
 * Two layers, both data-driven:
 *
 *  1. **Role matrix** — `roles` × `permissions` in the DB. The code below defines
 *     the four roles and the permission keys they get; `src/db/seed/rbac.ts` writes
 *     that into `role_permissions` so admins can *see* the matrix in the UI and so
 *     a later phase can let them change it without touching code.
 *  2. **Resource grants** — `resource_permissions`, for "share this specific calendar
 *     with this specific user". Phase 2+ writes rows here; this module is the only
 *     reader.
 *
 * Two rules are load-bearing for the whole project:
 *
 *  - **Read is explicit.** A `*.view.*` permission is required to read anything;
 *    nothing is visible by default.
 *  - **No self-escalation.** A role can only be granted to another user if the actor
 *    holds `roles.assign` (super_admin only) and the target role is not above the
 *    actor's own rank.
 *
 * Ownership semantics (`*.view.own` vs `*.view.any`) are decided by the *service*
 * layer that owns the table (Phase 2+), not here: this module answers "does this
 * role hold this permission" and "does this user hold a grant on this resource".
 */

export const ROLE_KEYS = [
  "super_admin",
  "admin",
  "user",
  "read_only",
] as const satisfies readonly RoleKey[];

export const PRIVILEGED_ROLES: readonly RoleKey[] = ["super_admin", "admin"];

export const PERMISSION_KEYS = [
  // Content read permissions (spec §12: "read" is its own permission).
  "dashboard.view",
  "calendar.view.any",
  "calendar.view.own",
  "calendar.view.shared",
  "tasks.view.any",
  "tasks.view.own",
  "tasks.view.shared",
  "projects.view.any",
  "projects.view.own",
  "projects.view.shared",
  "assets.view.any",
  "assets.view.own",
  "assets.view.shared",
  "onedrive.view",
  "onedrive.manage",
  // Content write permissions.
  "calendar.create",
  "calendar.edit.any",
  "calendar.edit.own",
  "calendar.share",
  "tasks.create",
  "tasks.edit.any",
  "tasks.edit.own",
  "tasks.complete",
  "tasks.share",
  "projects.create",
  "projects.edit.any",
  "projects.edit.own",
  "assets.upload",
  "assets.edit.own",
  "assets.edit.any",
  "assets.download",
  "assets.link_calendar",
  "assets.link_task",
  // Notifications (Phase 3).
  "notifications.view",
  "notifications.send",
  "notifications.manage",
  // Productivity foundations shared by the Phase 2 modules (packet 2A). Mirrors
  // the Phase 1 split: `own` is the actor's own work, `shared` is a resource
  // explicitly shared through `resource_permissions`, `any` is the administrative
  // global view. `tags.attach` gates using a tag on a resource the actor may edit;
  // `tags.edit.any` is tag *administration* (rename/delete someone else's tag),
  // not a licence to edit their content.
  "tags.view.own",
  "tags.view.shared",
  "tags.view.any",
  "tags.create",
  "tags.edit.own",
  "tags.edit.any",
  "tags.attach",
  // The user-visible feed of their own work (spec §16). A different table and a
  // different permission from `audit.view`, which is the security trail.
  "activity.view.own",
  "activity.view.shared",
  "activity.view.any",
  "activity.record",
  // Gates the search *feature* only: every result row is filtered by the caller's
  // own/shared/any view permission for that resource kind, so holding this key
  // grants no read access by itself (packet 2S).
  "search.view",
  // Self-service.
  "profile.view_own",
  "profile.edit_own",
  "settings.view_own",
  "settings.edit_own",
  // Account security. Deliberately separate from `settings.edit_own`: every role,
  // including `read_only`, must be able to change its own password and manage its
  // own second factor, because "reads everything, changes nothing" is a rule about
  // *content*, not about keeping one's own account safe.
  "security.view_own",
  "security.password_change_own",
  "security.mfa_manage_own",
  "security.sessions_manage_own",
  // Directory and user administration.
  "users.view_directory",
  "users.view",
  "users.create",
  "users.edit",
  "users.deactivate",
  "users.revoke_sessions",
  "users.reset_password",
  "roles.view",
  "roles.assign",
  // Integrations and settings administration (Phase 3/5).
  "settings.integrations.view",
  "settings.integrations.edit",
  "settings.system.edit",
  // Audit (Phase 1.11 records, Phase 8 exposes).
  "audit.view",
  // Impersonation (admin support tool, audited).
  "users.impersonate",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export interface RoleDefinition {
  key: RoleKey;
  rank: number;
  privileged: boolean;
  permissions: readonly PermissionKey[];
}

const VIEW_ALL = [
  "dashboard.view",
  "calendar.view.any",
  "calendar.view.own",
  "calendar.view.shared",
  "tasks.view.any",
  "tasks.view.own",
  "tasks.view.shared",
  "projects.view.any",
  "projects.view.own",
  "projects.view.shared",
  "assets.view.any",
  "assets.view.own",
  "assets.view.shared",
  "onedrive.view",
  "users.view_directory",
  "profile.view_own",
  "settings.view_own",
  "notifications.view",
  "roles.view",
] as const;

const SELF_SERVICE = [
  "profile.edit_own",
  "settings.edit_own",
  "calendar.create",
  "calendar.edit.own",
  "calendar.share",
  "tasks.create",
  "tasks.edit.own",
  "tasks.complete",
  "tasks.share",
  "projects.create",
  "projects.edit.own",
  "assets.upload",
  "assets.edit.own",
  "assets.download",
  "assets.link_calendar",
  "assets.link_task",
] as const;

const USER_VIEWS = [
  "dashboard.view",
  "calendar.view.own",
  "calendar.view.shared",
  "tasks.view.own",
  "tasks.view.shared",
  "projects.view.own",
  "projects.view.shared",
  "assets.view.own",
  "assets.view.shared",
  "onedrive.view",
  "users.view_directory",
  "profile.view_own",
  "settings.view_own",
  "notifications.view",
  "roles.view",
] as const;

/**
 * Phase 2A (packet 2A): tags and the user-visible activity feed. Deliberately
 * split the same way as the Phase 1 content permissions, because "give a user a
 * tag vocabulary and a work history" must not silently become "give them the
 * global view": `*_ANY` groups are only ever added to the two privileged roles,
 * and `read_only` gets the shared view with no write key at all.
 */
const TAGS_SELF = [
  "tags.view.own",
  "tags.view.shared",
  "tags.create",
  "tags.edit.own",
  "tags.attach",
] as const;

const TAGS_ADMIN_EXTRA = ["tags.view.any", "tags.edit.any"] as const;

const TAGS_SHARED_ONLY = ["tags.view.shared"] as const;

const ACTIVITY_SELF = ["activity.view.own", "activity.view.shared", "activity.record"] as const;

const ACTIVITY_ADMIN_EXTRA = ["activity.view.any"] as const;

const ACTIVITY_SHARED_ONLY = ["activity.view.shared"] as const;

const SEARCH_VIEW = ["search.view"] as const;

/**
 * Held by every role, `read_only` included (see the note in `PERMISSION_KEYS`).
 * Without these an account could never secure itself: a `read_only` user could not
 * change a leaked password, and a privileged account with no second factor yet
 * could not reach the screen that enrolls one.
 */
const SELF_SECURITY = [
  "security.view_own",
  "security.password_change_own",
  "security.mfa_manage_own",
  "security.sessions_manage_own",
] as const;

/**
 * The permission matrix. `super_admin` holds everything; `admin` runs day-to-day
 * user and content administration but cannot reassign roles or change system
 * settings; `user` manages their own work; `read_only` sees without touching.
 */
export const ROLE_DEFINITIONS: readonly RoleDefinition[] = [
  {
    key: "super_admin",
    rank: 1,
    privileged: true,
    permissions: [...PERMISSION_KEYS],
  },
  {
    key: "admin",
    rank: 2,
    privileged: true,
    permissions: [
      ...VIEW_ALL,
      ...SELF_SERVICE,
      ...SELF_SECURITY,
      "calendar.edit.any",
      "tasks.edit.any",
      "projects.edit.any",
      "assets.edit.any",
      "onedrive.manage",
      "notifications.send",
      "notifications.manage",
      ...TAGS_SELF,
      ...TAGS_ADMIN_EXTRA,
      ...ACTIVITY_SELF,
      ...ACTIVITY_ADMIN_EXTRA,
      ...SEARCH_VIEW,
      "users.view",
      "users.create",
      "users.edit",
      "users.deactivate",
      "users.revoke_sessions",
      "users.reset_password",
      "users.impersonate",
      "settings.integrations.view",
      "audit.view",
    ],
  },
  {
    key: "user",
    rank: 3,
    privileged: false,
    permissions: [
      ...USER_VIEWS,
      ...SELF_SERVICE,
      ...SELF_SECURITY,
      ...TAGS_SELF,
      ...ACTIVITY_SELF,
      ...SEARCH_VIEW,
    ],
  },
  {
    key: "read_only",
    rank: 4,
    privileged: false,
    permissions: [
      "dashboard.view",
      "calendar.view.shared",
      "tasks.view.shared",
      "projects.view.shared",
      "assets.view.shared",
      "users.view_directory",
      "profile.view_own",
      "settings.view_own",
      "notifications.view",
      "roles.view",
      ...TAGS_SHARED_ONLY,
      ...ACTIVITY_SHARED_ONLY,
      ...SEARCH_VIEW,
      ...SELF_SECURITY,
    ],
  },
];

const ROLE_BY_KEY = new Map(ROLE_DEFINITIONS.map((role) => [role.key, role]));
const PERMISSION_SET = new Set<string>(PERMISSION_KEYS);

/**
 * Permissions a privileged account may use *before* it has a second factor.
 *
 * A rule that says "privileged roles need MFA" is a locked door if the screen that
 * enrolls MFA is behind that rule. These four are the way out, and each one pays
 * for itself another way: every action that changes credentials or factors sends
 * the account password to Better Auth's own endpoint, which verifies it against the
 * Argon2id hash before changing anything.
 */
export const MFA_EXEMPT_PERMISSIONS: readonly PermissionKey[] = [
  "security.view_own",
  "security.password_change_own",
  "security.mfa_manage_own",
  "security.sessions_manage_own",
];

export class AuthorizationError extends Error {
  constructor(
    readonly reason:
      "missing_permission" | "mfa_required" | "role_too_high" | "no_self_change" | "stale_session",
    message: string,
  ) {
    super(message);
    this.name = "AuthorizationError";
  }
}

export class RbacConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RbacConfigError";
  }
}

export function isRoleKey(value: unknown): value is RoleKey {
  return typeof value === "string" && ROLE_BY_KEY.has(value as RoleKey);
}

export function isPermissionKey(value: unknown): value is PermissionKey {
  return typeof value === "string" && PERMISSION_SET.has(value);
}

export function roleDefinition(role: RoleKey): RoleDefinition {
  const definition = ROLE_BY_KEY.get(role);
  if (!definition) throw new RbacConfigError(`Unknown role "${role}".`);
  return definition;
}

export function isPrivilegedRole(role: RoleKey): boolean {
  return PRIVILEGED_ROLES.includes(role);
}

export interface Actor {
  userId: string;
  role: RoleKey;
  twoFactorEnabled: boolean;
  /** True when the session itself is newer than the fresh-session window. */
  sessionFresh: boolean;
  /** Set only while an admin is impersonating another user. */
  impersonatedBy?: string | null;
}

/** Role-matrix answer, read from the DB so a later phase can make the matrix editable. */
export async function roleHoldsPermission(
  role: RoleKey,
  permission: PermissionKey,
): Promise<boolean> {
  const row = await getDb()
    .select({ one: role_permissions.roleKey })
    .from(role_permissions)
    .where(and(eq(role_permissions.roleKey, role), eq(role_permissions.permissionKey, permission)))
    .limit(1);
  if (row.length > 0) return true;

  // A role the code does not know about can never be authorized: fail closed.
  if (!ROLE_BY_KEY.has(role)) {
    getLogger("rbac").warn("authorization denied for unknown role", { role });
    return false;
  }
  return false;
}

/**
 * The one authorization entry point (spec §12: permission checks centralized in
 * services). Every mutation and every read route goes through here, so there is
 * exactly one place that can grant access.
 */
export async function authorize(
  actor: Actor,
  permission: PermissionKey,
  options: { requireFreshSession?: boolean } = {},
): Promise<void> {
  if (!isPermissionKey(permission))
    throw new RbacConfigError(`Unknown permission "${permission}".`);

  if (!(await roleHoldsPermission(actor.role, permission))) {
    throw new AuthorizationError(
      "missing_permission",
      `Role "${actor.role}" does not hold permission "${permission}".`,
    );
  }

  const cfg = getConfig().auth;
  if (
    cfg.privilegedRolesRequireMfa &&
    isPrivilegedRole(actor.role) &&
    !actor.twoFactorEnabled &&
    !MFA_EXEMPT_PERMISSIONS.includes(permission)
  ) {
    throw new AuthorizationError(
      "mfa_required",
      `Role "${actor.role}" requires an enrolled two-factor authenticator (spec §12 policy).`,
    );
  }

  if (options.requireFreshSession && !actor.sessionFresh) {
    throw new AuthorizationError(
      "stale_session",
      "This action requires a freshly authenticated session (sign in again).",
    );
  }
}

export async function can(actor: Actor, permission: PermissionKey): Promise<boolean> {
  try {
    await authorize(actor, permission);
    return true;
  } catch {
    return false;
  }
}

/** Explicit per-resource grant (Phase 2+ writes these; the sharing UI reads them). */
export async function hasResourceGrant(
  userId: string,
  resourceType: string,
  resourceId: string,
  permission: PermissionKey,
): Promise<boolean> {
  const row = await getDb()
    .select({ one: resource_permissions.id })
    .from(resource_permissions)
    .where(
      and(
        eq(resource_permissions.granteeUserId, userId),
        eq(resource_permissions.resourceType, resourceType),
        eq(resource_permissions.resourceId, resourceId),
        eq(resource_permissions.permissionKey, permission),
      ),
    )
    .limit(1);
  return row.length > 0;
}

/**
 * Role assignment rules (spec §12: "changing a role or permission must be
 * audited, restricted to a dedicated permission, and require re-authentication").
 */
export async function assertCanAssignRole(
  actor: Actor,
  targetRole: RoleKey,
  targetUserId: string,
): Promise<void> {
  await authorize(actor, "roles.assign", { requireFreshSession: true });

  if (targetUserId === actor.userId) {
    throw new AuthorizationError("no_self_change", "A user cannot change their own role.");
  }

  const actorRole = roleDefinition(actor.role);
  const target = roleDefinition(targetRole);
  if (target.rank < actorRole.rank) {
    throw new AuthorizationError(
      "role_too_high",
      `Role "${targetRole}" outranks the actor's role "${actorRole.key}".`,
    );
  }
}

/** Directory listing shape used by the users UI and by sharing pickers. */
export interface DirectoryUser {
  id: string;
  name: string;
  email: string;
  role: RoleKey;
  twoFactorEnabled: boolean;
  banned: boolean;
  createdAt: string;
  language: string | null;
  timezone: string;
}

export async function listDirectory(limit = 200): Promise<DirectoryUser[]> {
  const defaultTimezone = getConfig().defaultTimezone;
  const rows = await getDb()
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      twoFactorEnabled: users.twoFactorEnabled,
      banned: users.banned,
      createdAt: users.createdAt,
      language: user_preferences.language,
      timezone: user_preferences.timezone,
    })
    .from(users)
    .leftJoin(user_preferences, eq(user_preferences.userId, users.id))
    .orderBy(users.name)
    .limit(limit);

  return rows.map((row) => ({
    ...row,
    // `users.role` is a text column: an unknown value is treated as the least
    // privileged role instead of granting whatever the string says.
    role: isRoleKey(row.role) ? row.role : "read_only",
    timezone: row.timezone ?? defaultTimezone,
  }));
}

/** Permission catalog with grants per role, for the read-only permissions view. */
export async function readRoleMatrix(): Promise<
  { role: RoleKey; privileged: boolean; rank: number; permissions: PermissionKey[] }[]
> {
  const rows = await getDb()
    .select({
      roleKey: roles.key,
      privileged: roles.privileged,
      rank: roles.rank,
      permissionKey: role_permissions.permissionKey,
    })
    .from(roles)
    .leftJoin(role_permissions, eq(role_permissions.roleKey, roles.key))
    .orderBy(roles.rank, role_permissions.permissionKey);

  const byRole = new Map<
    RoleKey,
    { role: RoleKey; privileged: boolean; rank: number; permissions: PermissionKey[] }
  >();
  for (const row of rows) {
    if (!isRoleKey(row.roleKey)) continue;
    const entry = byRole.get(row.roleKey) ?? {
      role: row.roleKey,
      privileged: row.privileged,
      rank: row.rank,
      permissions: [],
    };
    if (row.permissionKey && isPermissionKey(row.permissionKey))
      entry.permissions.push(row.permissionKey);
    byRole.set(entry.role, entry);
  }
  return [...byRole.values()].sort((a, b) => a.rank - b.rank);
}

/**
 * How many accounts can currently administer the install (1.3).
 *
 * Two callers need exactly this number and must agree on its meaning:
 *  - the bootstrap CLI, which refuses to create a second privileged account by accident;
 *  - the administration guard, which refuses to demote, block or delete the last one,
 *    because an install with no way back in is not one anyone can fix.
 *
 * An account with an unverified MFA enrollment still counts: it can reach the security
 * screen that finishes enrollment (see `MFA_EXEMPT_PERMISSIONS`), so it is a way back
 * in. A banned account does not count, because it is not one.
 */
export function activePrivilegedAccountCount(): number {
  return (
    getDb()
      .select({ c: count() })
      .from(users)
      .where(and(inArray(users.role, [...PRIVILEGED_ROLES]), eq(users.banned, false)))
      .get()?.c ?? 0
  );
}

/** Used by the bootstrap CLI and tests to confirm the matrix was seeded. */
export async function readMatrixCounts(): Promise<{
  roles: number;
  permissions: number;
  grants: number;
}> {
  const roleRows = await getDb()
    .select({ key: roles.key })
    .from(roles)
    .where(inArray(roles.key, [...ROLE_KEYS]));
  const permissionRows = await getDb()
    .select({ key: permissions.key })
    .from(permissions)
    .where(inArray(permissions.key, [...PERMISSION_KEYS]));
  const grantRows = await getDb()
    .select({ one: role_permissions.roleKey })
    .from(role_permissions)
    .where(
      and(
        inArray(role_permissions.roleKey, [...ROLE_KEYS]),
        inArray(role_permissions.permissionKey, [...PERMISSION_KEYS]),
      ),
    );
  return { roles: roleRows.length, permissions: permissionRows.length, grants: grantRows.length };
}
