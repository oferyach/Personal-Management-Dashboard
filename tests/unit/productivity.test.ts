import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ACTIVITY_ACTIONS,
  ACTIVITY_RESOURCE_KINDS,
  MAX_PAGE_SIZE,
  MAX_QUERY_WINDOW_DAYS,
  PRODUCTIVITY_RESOURCE_KINDS,
  TAG_NAME_MAX_LENGTH,
  clampPageSize,
  isActivityAction,
  isActivityResourceKind,
  isProductivityResourceKind,
  isUniqueConstraintError,
  normalizeTagName,
  parseQueryWindow,
  requireResourceId,
  visibilityOf,
  ProductivityError,
} from "@/lib/productivity";

/** Fails with the shared error class carrying the machine-readable `reason`. */
function reasonOf(thrower: () => unknown): string {
  try {
    thrower();
  } catch (error) {
    expect(error).toBeInstanceOf(ProductivityError);
    return (error as ProductivityError).reason;
  }
  throw new Error("expected a ProductivityError");
}

/**
 * The generated migration is the only place a CHECK constraint exists, so the
 * TypeScript vocabulary and the database constraint can drift silently. This test
 * reads the committed SQL and compares the two lists, in order.
 */
describe("productivity vocabulary is locked to the schema", () => {
  const sql = readFileSync(
    resolve(import.meta.dirname, "../../drizzle/0002_phase2a_productivity.sql"),
    "utf8",
  );

  const checks = new Map<string, string[]>();
  for (const match of sql.matchAll(/CONSTRAINT "(\w+)" CHECK\("(\w+)" in \(([^)]*)\)/g)) {
    checks.set(
      match[1]!,
      match[3]!.split(",").map((part) => part.trim().replace(/^'|'$/g, "")),
    );
  }

  it("parses the CHECK constraints out of the migration", () => {
    expect([...checks.keys()].sort()).toEqual([
      "activity_log_action_chk",
      "activity_log_resource_kind_chk",
      "tag_links_resource_kind_chk",
    ]);
  });

  it("keeps every exported list identical to its CHECK constraint", () => {
    expect(checks.get("activity_log_action_chk")).toEqual([...ACTIVITY_ACTIONS]);
    expect(checks.get("activity_log_resource_kind_chk")).toEqual([...ACTIVITY_RESOURCE_KINDS]);
    expect(checks.get("tag_links_resource_kind_chk")).toEqual([...PRODUCTIVITY_RESOURCE_KINDS]);
  });

  it("treats `tag` as an activity kind only, never a taggable resource", () => {
    expect(isProductivityResourceKind("tag")).toBe(false);
    expect(isActivityResourceKind("tag")).toBe(true);
    expect(isActivityAction("progress_changed")).toBe(true);
    expect(isActivityAction("deleted_another_users_row")).toBe(false);
    expect(isActivityResourceKind("session")).toBe(false);
  });
});

describe("tag name normalization", () => {
  it("folds case, whitespace and Unicode form onto one identity", () => {
    const typed = normalizeTagName("   Work\u00A0  two  ");
    expect(typed.display).toBe("Work two");
    expect(typed.normalized).toBe("work two");
    // "é" composed (U+00E9) and decomposed (e + U+0301) are the same tag.
    expect(normalizeTagName("caf\u{E9}").normalized).toBe(
      normalizeTagName("cafe\u{0301}").normalized,
    );
    expect(normalizeTagName("cafe\u{0301}").display).toBe("caf\u{E9}");
    // A non-Latin script (Hebrew alef-vav-alef-kaf = "work") is trimmed but never
    // case-folded or transliterated.
    const hebrew = String.fromCharCode(0x05d6, 0x05d4, 0x05d6, 0x05df);
    expect(normalizeTagName(`  ${hebrew}\u00A0 `).display).toBe(hebrew);
    expect(normalizeTagName(`  ${hebrew}  `).normalized).toBe(hebrew);
  });

  it("refuses names that could not be typed back in", () => {
    for (const bad of ["", "   ", "\u0000tag", "a\u001Fb", "x\u007F", "y\u009A", "\u0009tab"]) {
      expect(
        reasonOf(() => normalizeTagName(bad)),
        JSON.stringify(bad),
      ).toBe("invalid_tag_name");
    }
    expect(reasonOf(() => normalizeTagName(42))).toBe("invalid_tag_name");
  });

  it("bounds the name length", () => {
    const atLimit = normalizeTagName("t".repeat(TAG_NAME_MAX_LENGTH));
    expect(atLimit.normalized).toHaveLength(TAG_NAME_MAX_LENGTH);
    expect(reasonOf(() => normalizeTagName("t".repeat(TAG_NAME_MAX_LENGTH + 1)))).toBe(
      "tag_name_too_long",
    );
  });
});

describe("query input guards", () => {
  it("rejects malformed or over-long resource ids", () => {
    expect(requireResourceId("0f9d1b2e-6b3f-4a1e-9c2d-7f8a9b0c1d2e")).toBe(
      "0f9d1b2e-6b3f-4a1e-9c2d-7f8a9b0c1d2e",
    );
    expect(reasonOf(() => requireResourceId(""))).toBe("invalid_resource_id");
    expect(reasonOf(() => requireResourceId("has space"))).toBe("invalid_resource_id");
    expect(reasonOf(() => requireResourceId("x".repeat(192)))).toBe("invalid_resource_id");
  });

  it("accepts only ISO-8601 windows, ordered and bounded", () => {
    const window = parseQueryWindow({
      from: "2026-11-01",
      to: "2026-11-30T23:59:59+02:00",
    });
    expect(window.from).toBe("2026-11-01T00:00:00.000Z");
    expect(window.to.startsWith("2026-11-30T21:")).toBe(true);

    // A US-style date is refused rather than guessed.
    expect(reasonOf(() => parseQueryWindow({ from: "12/05/2026", to: "2026-12-05" }))).toBe(
      "invalid_window",
    );
    expect(reasonOf(() => parseQueryWindow({ from: "2026-11-10", to: "2026-11-01" }))).toBe(
      "invalid_window",
    );
    expect(reasonOf(() => parseQueryWindow({ from: "2020-01-01", to: "2026-01-01" }))).toBe(
      "window_too_large",
    );
    expect(
      parseQueryWindow({
        from: "2026-01-01",
        to: new Date(
          Date.parse("2026-01-01") + MAX_QUERY_WINDOW_DAYS * 86_400_000 - 1000,
        ).toISOString(),
      }).from,
    ).toBe("2026-01-01T00:00:00.000Z");
  });

  it("clamps page size into the indexed bound", () => {
    expect(clampPageSize(undefined)).toBe(50);
    expect(clampPageSize(0)).toBe(50);
    expect(clampPageSize(-5)).toBe(50);
    expect(clampPageSize(1.5)).toBe(50);
    expect(clampPageSize(5_000)).toBe(MAX_PAGE_SIZE);
    expect(clampPageSize(7)).toBe(7);
  });

  it("reads the visibility level out of a permission key", () => {
    expect(visibilityOf("tags.view.any")).toBe("any");
    expect(visibilityOf("tags.view.shared")).toBe("shared");
    expect(visibilityOf("tags.view.own")).toBe("own");
    expect(visibilityOf("tags.create")).toBeNull();
  });

  it("recognizes the unique-constraint failure the services translate", () => {
    expect(
      isUniqueConstraintError({ code: "SQLITE_CONSTRAINT_UNIQUE", message: "no two rows" }),
    ).toBe(true);
    expect(isUniqueConstraintError(new Error("UNIQUE constraint failed: tags.owner_user_id"))).toBe(
      true,
    );
    expect(isUniqueConstraintError(new Error("no such table: tags"))).toBe(false);
    expect(isUniqueConstraintError(null)).toBe(false);
  });
});
