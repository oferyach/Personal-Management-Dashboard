/**
 * Redaction (spec §14: secrets must never appear in logs, stack traces or
 * diagnostics).
 *
 * Applied at the boundary that writes to logs and to the status page, so no
 * caller has to remember to redact.
 */

const KEY_NAME_PATTERNS = [
  "password",
  "passwd",
  "secret",
  "token",
  "authorization",
  "cookie",
  "refreshtoken",
  "accesstoken",
  "clientsecret",
  "encryptionkey",
  "totp",
  "backupcode",
  "apikey",
];

const VALUE_PATTERNS: RegExp[] = [
  // Argon2 / bcrypt / scrypt PHC strings.
  /^\$argon2[idx]?\$/,
  /^\$2[aby]\$/,
  // Bearer-style tokens.
  /^[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{8,}/,
  // Long opaque hex/base64 blobs (session tokens, JWTs, random ids).
  /^[A-Za-z0-9+/_-]{40,}={0,}$/,
];

export const REDACTED = "[redacted]";

function looksLikeSecretKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, "");
  return KEY_NAME_PATTERNS.some((pattern) => normalized.includes(pattern));
}

function looksLikeSecretValue(value: string): boolean {
  if (value.length < 24) return false;
  return VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

export function isSecretKeyName(key: string): boolean {
  return looksLikeSecretKey(key);
}

/**
 * Returns a copy of `value` with anything that looks like a credential replaced by
 * `[redacted]`. Structural keys are preserved so a log line is still useful.
 */
export function redact<T>(value: T): T {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return (looksLikeSecretValue(trimmed) ? REDACTED : value) as T;
  }
  if (Array.isArray(value)) return value.map((item) => redact(item)) as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = looksLikeSecretKey(key)
        ? REDACTED
        : looksLikeSecretValue(typeof item === "string" ? item : "")
          ? REDACTED
          : redact(item);
    }
    return out as T;
  }
  return value;
}

/** Short, stable, non-reversible preview used by status pages and diagnostics. */
export function preview(value: string, keep = 4): string {
  if (!value) return "";
  if (value.length <= keep * 2) return REDACTED;
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}

export function isRedacted(value: unknown): boolean {
  return value === REDACTED;
}
