import { afterEach, describe, expect, it } from "vitest";

import { getSqlite } from "@/db/client";
import { seedRbac } from "@/db/seed/rbac";
import { PERMISSION_KEYS, ROLE_DEFINITIONS } from "@/lib/rbac";
import { closeTestDatabases, resetTestDatabase } from "../helpers/testDb";

/**
 * Packet 2A makes the matrix data, not code: the new productivity keys are seeded
 * by the same path startup uses, so re-running it against an already-seeded
 * database must be a no-op rather than a duplicate-grant or a grant-loss event.
 */

const PACKET_2A_KEYS = [
  "tags.view.own",
  "tags.view.shared",
  "tags.view.any",
  "tags.create",
  "tags.edit.own",
  "tags.edit.any",
  "tags.attach",
  "activity.view.own",
  "activity.view.shared",
  "activity.view.any",
  "activity.record",
  "search.view",
] as const;

function grantRows(): { grant: string; grantedAt: string }[] {
  const rows = getSqlite()
    .prepare("SELECT role_key, permission_key, granted_at FROM role_permissions")
    .all() as {
    role_key: string;
    permission_key: string;
    granted_at: string;
  }[];
  return rows.map((row) => ({
    grant: `${row.role_key} -> ${row.permission_key}`,
    grantedAt: row.granted_at,
  }));
}

const desiredGrants = ROLE_DEFINITIONS.flatMap((role) =>
  role.permissions.map((permission) => `${role.key} -> ${permission}`),
);

afterEach(() => closeTestDatabases());

describe("RBAC seed (packet 2A)", () => {
  it("seeds every shared productivity key and matches the definitions exactly", () => {
    resetTestDatabase("rbac-seed");

    const permissions = getSqlite().prepare("SELECT key FROM permissions").all() as {
      key: string;
    }[];
    const keys = permissions.map(({ key }) => key);
    expect(keys.sort()).toEqual([...PERMISSION_KEYS].sort());
    for (const key of PACKET_2A_KEYS) {
      expect(keys, key).toContain(key);
    }

    const actual = grantRows().map((row) => row.grant);
    expect(actual.sort()).toEqual([...desiredGrants].sort());
    expect(new Set(actual).size).toBe(actual.length);
  });

  it("re-seeding adds and removes nothing and leaves grants untouched", () => {
    resetTestDatabase("rbac-seed");

    const before = grantRows();
    const second = seedRbac();
    expect(second.grantsAdded).toBe(0);
    expect(second.grantsRemoved).toBe(0);
    expect(second.rolesWritten).toBe(ROLE_DEFINITIONS.length);
    expect(second.permissionsWritten).toBe(PERMISSION_KEYS.length);

    const after = grantRows();
    expect(after.length).toBe(before.length);
    expect(after.sort()).toEqual(before.sort());

    // A third run through the same path proves the no-op is not a one-shot cache.
    expect(seedRbac().grantsAdded).toBe(0);
  });

  it("keeps the four roles present and their privileged flags stable", () => {
    resetTestDatabase("rbac-seed");
    seedRbac();

    const roles = getSqlite()
      .prepare("SELECT key, privileged, rank FROM roles ORDER BY rank")
      .all() as {
      key: string;
      privileged: number;
      rank: number;
    }[];
    expect(roles.map(({ key }) => key)).toEqual(["super_admin", "admin", "user", "read_only"]);
    expect(roles.map(({ key, privileged }) => `${key}:${privileged}`)).toEqual([
      "super_admin:1",
      "admin:1",
      "user:0",
      "read_only:0",
    ]);
  });
});
