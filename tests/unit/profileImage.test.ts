import { describe, expect, it } from "vitest";

import { MAX_PROFILE_IMAGE_BYTES, validateProfileImage } from "@/lib/profileImage";

describe("profile-image validation", () => {
  it("accepts supported MIME types only when the magic bytes agree", () => {
    expect(
      validateProfileImage("image/png", new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0])),
    ).toBe("image/png");
    expect(() => validateProfileImage("image/png", new Uint8Array([255, 216, 255]))).toThrow();
    expect(() =>
      validateProfileImage("image/svg+xml", new Uint8Array([60, 115, 118, 103])),
    ).toThrow();
  });

  it("rejects empty and oversized files", () => {
    expect(() => validateProfileImage("image/jpeg", new Uint8Array())).toThrow();
    expect(() =>
      validateProfileImage("image/jpeg", new Uint8Array(MAX_PROFILE_IMAGE_BYTES + 1)),
    ).toThrow();
  });
});
