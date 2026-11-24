import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { getEnv } from "./env";
import { redact } from "./redact";

/**
 * Secret storage for values that must be readable by the app (spec §12: TOTP
 * secrets and integration tokens/refresh tokens encrypted at rest with versioned
 * key IDs).
 *
 * AES-256-GCM from Node's own crypto, keyed by HKDF-SHA256 over
 * `APP_ENCRYPTION_KEY`. Every stored value is prefixed with a **key id**
 * (`v1:`), so keys can be rotated without guessing: a `v1:` value is always read
 * with key 1, and a future `v2:` value with key 2, which is what makes the
 * Phase 6 backup/restore and key-rotation stories possible.
 *
 * What this does *not* do: hash passwords (Argon2id in `src/lib/passwords.ts`)
 * or sign cookies (Better Auth does that). No home-grown primitives — only
 * `node:crypto` algorithms with documented parameters.
 */

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HKDF_INFO_PREFIX = "pmd.data-key.v";

export class SecretStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretStoreError";
  }
}

function dataKey(keyVersion: number): Buffer {
  const { encryptionKey, encryptionKeyVersion } = getEnv();
  if (keyVersion > encryptionKeyVersion) {
    throw new SecretStoreError(
      `Stored value uses key version ${keyVersion}, but this instance only has version ${encryptionKeyVersion}.`,
    );
  }
  const salt = createHash("sha256").update(`pmd.master.v${keyVersion}`).digest();
  return Buffer.from(
    hkdfSync("sha256", encryptionKey, salt, `${HKDF_INFO_PREFIX}${keyVersion}`, 32),
  );
}

/** `v1.<iv>.<tag>.<ciphertext>`, base64url so it survives being stored as text. */
export function encryptSecret(plaintext: string, scope: string): string {
  const version = getEnv().encryptionKeyVersion;
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, dataKey(version), iv, {
    authTagLength: TAG_BYTES,
  });
  cipher.setAAD(Buffer.from(`pmd:${scope}:${version}`));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    `v${version}`,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptSecret(value: string, scope: string): string {
  const parts = value.split(".");
  if (parts.length !== 4) throw new SecretStoreError("Stored secret is malformed.");
  const [versionPart, ivPart, tagPart, dataPart] = parts;
  const match = /^v(\d+)$/.exec(versionPart ?? "");
  if (!match) throw new SecretStoreError("Stored secret has no key version.");
  const version = Number(match[1]);

  const iv = Buffer.from(ivPart ?? "", "base64url");
  const tag = Buffer.from(tagPart ?? "", "base64url");
  const ciphertext = Buffer.from(dataPart ?? "", "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) {
    throw new SecretStoreError("Stored secret is malformed.");
  }

  const decipher = createDecipheriv(ALGORITHM, dataKey(version), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(`pmd:${scope}:${version}`));
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM authentication failed: the value was tampered with or the key changed.
    throw new SecretStoreError("Stored secret failed authentication (tampering or key mismatch).");
  }
}

export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && /^v\d+\.[^.]+\.[^.]+\.[^.]+$/.test(value);
}

/**
 * Better Auth's `twoFactor` plugin hook for backup-code storage.
 *
 * The plugin's own options are "plain" (its default) or "encrypted" with the
 * *cookie signing* secret. Neither is acceptable here: backup codes are a second
 * factor, and the spec requires versioned key IDs. The hook gives us the seam, so
 * codes land in `two_factor.backup_codes` as `v1.<iv>.<tag>.<ct>`.
 */
export const backupCodeStore = {
  encrypt: async (data: string) => encryptSecret(data, "two_factor.backup_codes"),
  decrypt: async (data: string) => decryptSecret(data, "two_factor.backup_codes"),
};

/** Log/diagnostic-safe view of a secret (spec §14). */
export function describeEncryptedValue(value: string): string {
  if (!isEncryptedSecret(value)) return "unencrypted_or_unknown_format";
  const [version] = value.split(".");
  return `encrypted ${version} ${redact(value.slice(0, 12))}`;
}

/**
 * Compare two secrets without leaking timing (used where a secret acts as a
 * capability, e.g. an invite or recovery token).
 */
export function secretsEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
