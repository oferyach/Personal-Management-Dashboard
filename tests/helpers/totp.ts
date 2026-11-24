import { createHmac } from "node:crypto";

/**
 * RFC 6238 TOTP, used only in tests.
 *
 * The production code never generates a code: an authenticator app does, and Better
 * Auth verifies it. A test needs the other side of the same algorithm to prove the
 * library's implementation matches the standard (and that the secret in the
 * `otpauth://` URI is the one the factor was built from).
 */
export function totpCode(
  secretBase32: string,
  timeStepSec = 30,
  digits = 6,
  step = 0,
  atMs: number = Date.now(),
): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretBase32.toUpperCase().replace(/=/g, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error(`invalid base32 character: ${char}`);
    bits += index.toString(2).padStart(5, "0");
  }
  const key = Buffer.alloc(Math.floor(bits.length / 8));
  for (let i = 0; i < key.length; i += 1) key[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);

  const counter = BigInt(Math.floor(atMs / 1000 / timeStepSec) + step);
  const data = Buffer.alloc(8);
  data.writeBigUInt64BE(counter);

  const hmac = createHmac("sha1", key).update(data).digest();
  const offset = (hmac[hmac.length - 1] ?? 0) & 0x0f;
  const value =
    (((hmac[offset] ?? 0) & 0x7f) << 24) |
    (((hmac[offset + 1] ?? 0) & 0xff) << 16) |
    (((hmac[offset + 2] ?? 0) & 0xff) << 8) |
    ((hmac[offset + 3] ?? 0) & 0xff);
  return (value % 10 ** digits).toString().padStart(digits, "0");
}

/** The secret Better Auth put into the `otpauth://` URI. */
export function secretFromTotpUri(totpURI: string): string {
  const secret = new URL(totpURI).searchParams.get("secret");
  if (!secret) throw new Error(`no secret in totp URI: ${totpURI}`);
  return secret;
}
