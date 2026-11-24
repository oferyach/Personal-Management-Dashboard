import {
  createCipheriv,
  createDecipheriv,
  createHash,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { getEnv } from "./env";
import { passwordHasher } from "./passwords";
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
  decipher.setAuthTag(tag);
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
 * Better Auth's backup-code hook expects reversible storage, while the application
 * contract requires one-way hashes. The request candidate is carried in
 * AsyncLocalStorage by `withBackupCodeCandidate`: `decrypt()` verifies that candidate
 * against every Argon2id hash and gives the plugin a synthetic list containing the
 * candidate only at the matching position. When the plugin removes that entry and
 * calls `encrypt()` again, the matching hash disappears and every other hash is
 * preserved. Plain recovery codes are therefore never recoverable from SQLite.
 *
 * `v1.*` values from the pre-gate implementation remain readable and migrate to
 * hashes on the first successful recovery-code use.
 */
const BACKUP_HASH_PREFIX = "hash-v1.";
const backupCodeCandidate = new AsyncLocalStorage<string | null>();

function parseCodeList(data: string): string[] {
  const parsed: unknown = JSON.parse(data);
  if (!Array.isArray(parsed) || !parsed.every((value) => typeof value === "string")) {
    throw new SecretStoreError("Stored recovery codes are malformed.");
  }
  return parsed;
}

function readStoredCodeHashes(data: string): string[] {
  if (data.startsWith(BACKUP_HASH_PREFIX)) {
    return parseCodeList(
      Buffer.from(data.slice(BACKUP_HASH_PREFIX.length), "base64url").toString(),
    );
  }
  if (isEncryptedSecret(data)) return parseCodeList(decryptSecret(data, "two_factor.backup_codes"));
  throw new SecretStoreError("Stored recovery codes use an unknown format.");
}

export async function withBackupCodeCandidate<T>(
  request: Request,
  run: () => Promise<T>,
): Promise<T> {
  if (new URL(request.url).pathname.endsWith("/two-factor/verify-backup-code")) {
    let candidate: string | null = null;
    try {
      const body = (await request.clone().json()) as { code?: unknown };
      if (typeof body.code === "string" && body.code.length <= 128) candidate = body.code;
    } catch {
      candidate = null;
    }
    return backupCodeCandidate.run(candidate, run);
  }
  return run();
}

export const backupCodeStore = {
  encrypt: async (data: string) => {
    const values = parseCodeList(data);
    const hashes = await Promise.all(
      values.map((value) =>
        value.startsWith("$argon2id$") ? Promise.resolve(value) : passwordHasher.hash(value),
      ),
    );
    return `${BACKUP_HASH_PREFIX}${Buffer.from(JSON.stringify(hashes)).toString("base64url")}`;
  },
  decrypt: async (data: string) => {
    const values = readStoredCodeHashes(data);
    const candidate = backupCodeCandidate.getStore();
    if (!candidate) return "[]";

    const matches = await Promise.all(
      values.map((value) =>
        value.startsWith("$argon2id$")
          ? passwordHasher.verify({ candidate, storedHash: value })
          : Promise.resolve(secretsEqual(candidate, value)),
      ),
    );
    return JSON.stringify(values.map((value, index) => (matches[index] ? candidate : value)));
  },
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
