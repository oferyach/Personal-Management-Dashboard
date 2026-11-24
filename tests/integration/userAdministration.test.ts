import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ActionError } from "@/lib/actionError";
import { beginMfaEnrollment, confirmMfaEnrollment } from "@/lib/accountSecurity";
import { createFirstAdmin } from "@/lib/adminBootstrap";
import { readAudit } from "@/lib/audit";
import { resetAuthInstance } from "@/lib/auth";
import {
  assignUserRole,
  createManagedUser,
  resetUserPassword,
  setAccountActive,
} from "@/lib/userAdministration";
import type { ActionContext } from "@/lib/requestAuth";
import { actionContextFor } from "../helpers/signedIn";
import { closeTestDatabases, resetTestDatabase } from "../helpers/testDb";
import { secretFromTotpUri, totpCode } from "../helpers/totp";

const adminPassword = "Admin-Management-2026!";
const userPassword = "Standard-Management-2026!";
let admin: ActionContext;
let standard: ActionContext;

describe("user administration and isolation", () => {
  beforeAll(async () => {
    resetTestDatabase("user-administration");
    resetAuthInstance();

    await createFirstAdmin({
      name: "Standard User",
      email: "standard@example.internal",
      password: userPassword,
      role: "user",
    });
    await createFirstAdmin({
      name: "Super Admin",
      email: "admin@example.internal",
      password: adminPassword,
      role: "super_admin",
    });

    const incomplete = await actionContextFor("admin@example.internal", adminPassword);
    const enrollment = await beginMfaEnrollment(incomplete, adminPassword);
    const secret = secretFromTotpUri(enrollment.totpURI);
    await confirmMfaEnrollment(incomplete, totpCode(secret));

    admin = await actionContextFor("admin@example.internal", adminPassword, {
      totpSecret: secret,
    });
    standard = await actionContextFor("standard@example.internal", userPassword);
  });

  afterAll(() => closeTestDatabases());

  it("creates, role-changes, deactivates and resets an account with the real actor audited", async () => {
    const created = await createManagedUser(admin, {
      name: "Managed User",
      email: "managed@example.internal",
      role: "user",
    });
    expect(created.temporaryPassword).toHaveLength(20);
    expect(created.user.mustChangePassword).toBe(true);

    const roleChanged = await assignUserRole(admin, created.user.id, "read_only");
    expect(roleChanged.role).toBe("read_only");

    const deactivated = await setAccountActive(admin, created.user.id, false, "test");
    expect(deactivated.banned).toBe(true);
    await setAccountActive(admin, created.user.id, true);

    const reset = await resetUserPassword(admin, created.user.id);
    expect(reset.temporaryPassword).not.toBe(created.temporaryPassword);
    expect(reset.user.mustChangePassword).toBe(true);

    const creationRows = readAudit({ userId: created.user.id, action: "account_created" });
    expect(creationRows).toHaveLength(1);
    expect(creationRows[0]?.actorUserId).toBe(admin.user.id);
    expect(creationRows[0]?.detail).not.toContain(created.temporaryPassword);
  });

  it("denies guessed existing and nonexistent account ids before reading the target", async () => {
    for (const target of [admin.user.id, "00000000-0000-0000-0000-000000000000"]) {
      const error = await setAccountActive(standard, target, false).then(
        () => null,
        (caught: unknown) => caught,
      );
      expect(error).toBeInstanceOf(ActionError);
      expect((error as ActionError).notice).toBe("forbidden");
    }
  });
});
