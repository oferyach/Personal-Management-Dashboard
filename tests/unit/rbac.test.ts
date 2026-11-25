import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS, ROLE_DEFINITIONS } from "@/lib/rbac";

const role = (key: string) => ROLE_DEFINITIONS.find((entry) => entry.key === key)!;

/**
 * Packet 2A keys. `search.view` gates the feature only; every result row is still
 * filtered by the caller's own/shared/any view permission for that resource kind.
 */
const SHARED_KEYS = [
  "activity.record",
  "activity.view.any",
  "activity.view.own",
  "activity.view.shared",
  "search.view",
  "tags.attach",
  "tags.create",
  "tags.edit.any",
  "tags.edit.own",
  "tags.view.any",
  "tags.view.own",
  "tags.view.shared",
] as const;

const sharedGrantsOf = (key: string) =>
  role(key)
    .permissions.filter(
      (permission) =>
        permission.startsWith("tags.") ||
        permission.startsWith("activity.") ||
        permission === "search.view",
    )
    .sort();

describe("Phase 1 permission matrix", () => {
  it("keeps standard users inside own or explicitly shared resources", () => {
    const permissions = role("user").permissions;
    expect(permissions).toContain("calendar.view.own");
    expect(permissions).toContain("calendar.view.shared");
    expect(permissions).toContain("tasks.edit.own");
    expect(permissions.some((permission) => permission.endsWith(".view.any"))).toBe(false);
  });

  it("gives read-only users shared views and account security, but no content writes", () => {
    const permissions = role("read_only").permissions;
    expect(permissions).toEqual(
      expect.arrayContaining([
        "calendar.view.shared",
        "tasks.view.shared",
        "projects.view.shared",
        "assets.view.shared",
        "security.password_change_own",
        "security.mfa_manage_own",
      ]),
    );
    expect(permissions.some((permission) => permission.includes(".edit"))).toBe(false);
    expect(permissions.some((permission) => permission.endsWith(".view.any"))).toBe(false);
    expect(permissions.some((permission) => permission.endsWith(".view.own"))).toBe(false);
  });

  it("keeps the catalog and each role free of duplicate permissions", () => {
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    for (const definition of ROLE_DEFINITIONS) {
      expect(new Set(definition.permissions).size, definition.key).toBe(
        definition.permissions.length,
      );
    }
    for (const key of SHARED_KEYS) {
      expect(PERMISSION_KEYS, key).toContain(key);
    }
  });

  it("grants the shared productivity keys to exactly the intended roles", () => {
    // Administration may see and edit someone else's tag; a standard user may not,
    // and a read-only account sees only explicitly shared material while still
    // being allowed to open the search feature over its own grants.
    expect(sharedGrantsOf("super_admin")).toEqual([...SHARED_KEYS]);
    expect(sharedGrantsOf("admin")).toEqual([...SHARED_KEYS]);
    expect(sharedGrantsOf("user")).toEqual(SHARED_KEYS.filter((key) => !key.endsWith(".any")));
    expect(sharedGrantsOf("read_only")).toEqual([
      "activity.view.shared",
      "search.view",
      "tags.view.shared",
    ]);
  });
});
