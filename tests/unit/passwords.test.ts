import { describe, expect, it } from "vitest";

import {
  createPasswordHasher,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  validatePasswordStrength,
} from "@/lib/passwords";

describe("Argon2id password policy", () => {
  it("hashes and verifies without exposing the password", async () => {
    const hasher = createPasswordHasher();
    const password = "Correct-Horse-2026!";
    const storedHash = await hasher.hash(password);
    expect(storedHash).toMatch(/^\$argon2id\$/);
    expect(storedHash).not.toContain(password);
    await expect(hasher.verify({ candidate: password, storedHash })).resolves.toBe(true);
    await expect(hasher.verify({ candidate: `${password}x`, storedHash })).resolves.toBe(false);
    expect(hasher.needsRehash(storedHash)).toBe(false);
  });

  it("fails closed for malformed hashes and enforces length/whitespace rules", async () => {
    const hasher = createPasswordHasher();
    await expect(hasher.verify({ candidate: "anything", storedHash: "not-a-phc" })).resolves.toBe(
      false,
    );
    expect(validatePasswordStrength("x".repeat(MIN_PASSWORD_LENGTH - 1))).toContain(
      `too_short:${MIN_PASSWORD_LENGTH}`,
    );
    expect(validatePasswordStrength("x".repeat(MAX_PASSWORD_LENGTH + 1))).toContain(
      `too_long:${MAX_PASSWORD_LENGTH}`,
    );
    expect(validatePasswordStrength(` ${"x".repeat(MIN_PASSWORD_LENGTH)}`)).toContain(
      "leading_or_trailing_whitespace",
    );
  });
});
