import { and, eq, inArray } from "drizzle-orm";
import { getDb, getSqlite } from "@/db/client";
import { permissions, role_permissions, roles } from "@/db/schema";
import { PERMISSION_KEYS, ROLE_DEFINITIONS } from "@/lib/rbac";
import { getLogger } from "@/lib/log";

/**
 * RBAC seed (work item 1.2: "4 roles with permission sets seeded in the migration").
 *
 * The seed is idempotent and *converging*: after it runs, `role_permissions` equals
 * the reviewed matrix in `src/lib/rbac.ts` — missing grants are added, stale ones
 * removed. Drift between code and database becomes a test failure instead of a
 * production surprise.
 *
 * Phase 8 ("permission model editable in the admin UI") changes this: once admins
 * can edit the matrix, the seed must stop overwriting their edits. That switch is
 * recorded in PROGRESS.md when it happens; until then the code matrix is the source
 * of truth.
 */

export interface SeedResult {
  rolesWritten: number;
  permissionsWritten: number;
  grantsAdded: number;
  grantsRemoved: number;
}

function grantKey(roleKey: string, permissionKey: string): string {
  // NUL separator: neither key can contain it, so keys cannot collide.
  return `${roleKey}\u0000${permissionKey}`;
}

export function seedRbac(): SeedResult {
  const db = getDb();
  const sqlite = getSqlite();
  const now = new Date().toISOString();

  const runSeed = sqlite.transaction((): SeedResult => {
    for (const role of ROLE_DEFINITIONS) {
      db.insert(roles)
        .values({
          key: role.key,
          privileged: role.privileged,
          rank: role.rank,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: roles.key,
          set: { privileged: role.privileged, rank: role.rank, updatedAt: now },
        })
        .run();
    }

    db.insert(permissions)
      .values(PERMISSION_KEYS.map((key) => ({ key, createdAt: now, updatedAt: now })))
      .onConflictDoNothing()
      .run();

    const desired = new Map<string, { roleKey: string; permissionKey: string }>();
    for (const role of ROLE_DEFINITIONS) {
      for (const permissionKey of role.permissions) {
        desired.set(grantKey(role.key, permissionKey), { roleKey: role.key, permissionKey });
      }
    }

    const current = db
      .select({ roleKey: role_permissions.roleKey, permissionKey: role_permissions.permissionKey })
      .from(role_permissions)
      .all();

    const toInsert = [...desired.values()].filter(
      (grant) =>
        !current.some(
          (row) =>
            grantKey(row.roleKey, row.permissionKey) ===
            grantKey(grant.roleKey, grant.permissionKey),
        ),
    );
    const toRemove = current.filter(
      (row) => !desired.has(grantKey(row.roleKey, row.permissionKey)),
    );

    if (toInsert.length > 0) {
      db.insert(role_permissions)
        .values(toInsert.map((grant) => ({ ...grant, grantedAt: now })))
        .onConflictDoNothing()
        .run();
    }

    for (const grant of toRemove) {
      db.delete(role_permissions)
        .where(
          and(
            eq(role_permissions.roleKey, grant.roleKey),
            eq(role_permissions.permissionKey, grant.permissionKey),
          ),
        )
        .run();
    }

    return {
      rolesWritten: ROLE_DEFINITIONS.length,
      permissionsWritten: PERMISSION_KEYS.length,
      grantsAdded: toInsert.length,
      grantsRemoved: toRemove.length,
    };
  });
  const result = runSeed();

  getLogger("db").info("rbac matrix seeded", { ...result });
  return result;
}

/** Guard used by startup and tests: the four roles must exist before anyone signs in. */
export function rbacSeeded(): boolean {
  const rows = getDb()
    .select({ key: roles.key })
    .from(roles)
    .where(
      inArray(
        roles.key,
        ROLE_DEFINITIONS.map((role) => role.key),
      ),
    )
    .all();
  return rows.length === ROLE_DEFINITIONS.length;
}
