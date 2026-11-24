import { describe, expect, it } from "vitest";

import { PERMISSION_KEYS, ROLE_DEFINITIONS } from "@/lib/rbac";

const role = (key: string) => ROLE_DEFINITIONS.find((entry) => entry.key === key)!;

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
  });
});
