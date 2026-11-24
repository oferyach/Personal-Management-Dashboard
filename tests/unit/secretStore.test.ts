import { describe, expect, it } from "vitest";

import {
  backupCodeStore,
  decryptSecret,
  encryptSecret,
  withBackupCodeCandidate,
} from "@/lib/secretStore";

function recoveryRequest(code: string): Request {
  return new Request("http://127.0.0.1:4000/api/auth/two-factor/verify-backup-code", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code }),
  });
}

describe("secret storage", () => {
  it("round-trips AES-GCM data and rejects tampering", () => {
    const encrypted = encryptSecret("refresh-token", "test.scope");
    expect(encrypted).not.toContain("refresh-token");
    expect(decryptSecret(encrypted, "test.scope")).toBe("refresh-token");
    const parts = encrypted.split(".");
    const tag = Buffer.from(parts[2]!, "base64url");
    tag[0] = tag[0]! ^ 1;
    parts[2] = tag.toString("base64url");
    const tampered = parts.join(".");
    expect(() => decryptSecret(tampered, "test.scope")).toThrow(/tampering|failed/i);
  });

  it("stores recovery codes as one-way hashes and removes a used code", async () => {
    const codes = ["Alpha-12345", "Bravo-67890"];
    const stored = await backupCodeStore.encrypt(JSON.stringify(codes));
    expect(stored).toMatch(/^hash-v1\./);
    expect(stored).not.toContain(codes[0]!);
    expect(stored).not.toContain(codes[1]!);

    const decoded = await withBackupCodeCandidate(recoveryRequest(codes[0]!), () =>
      backupCodeStore.decrypt(stored),
    );
    const pluginView = JSON.parse(decoded) as string[];
    expect(pluginView).toContain(codes[0]!);
    const afterUse = await backupCodeStore.encrypt(
      JSON.stringify(pluginView.filter((code) => code !== codes[0])),
    );

    const reused = await withBackupCodeCandidate(recoveryRequest(codes[0]!), () =>
      backupCodeStore.decrypt(afterUse),
    );
    expect(JSON.parse(reused)).not.toContain(codes[0]);
  });
});
