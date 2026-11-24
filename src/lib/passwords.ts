import { hash, verify } from "@node-rs/argon2";
import { getConfig } from "./env";

/**
 * Argon2id password hashing (work item 1.3 / spec §12).
 *
 * The spec forbids home-grown crypto but requires a *recorded* choice of
 * algorithm and parameters. We use `@node-rs/argon2` with explicit parameters
 * (no library defaults), and every parameter is documented in
 * `docs/adr/0001-auth-and-sessions.md` and asserted in tests:
 *
 *   algorithm    Argon2id (`argon2id` variant, PHC string)
 *   memoryCost   19 MiB   (OWASP minimum for interactive logins)
 *   timeCost     2 passes
 *   parallelism  1
 *   hashLength   32 bytes
 *
 * Parameters are read from configuration (`ARGON2_*`) so they can be raised
 * without code changes; existing hashes keep working because `verify` reads the
 * parameters from the stored PHC string. A parameter change therefore migrates
 * lazily on next successful sign-in (re-hash), never by rewriting hashes.
 */

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /**
   * Named arguments on purpose. The first integration spike stored Argon2id
   * hashes correctly and still rejected every sign-in, because the call site
   * passed (password, hash) where the wrapper expected (hash, password). A
   * swapped verification pair fails silently, so positional arguments are not
   * offered here.
   */
  verify(input: VerifyPasswordInput): Promise<boolean>;
  /** True when the stored hash no longer matches current policy. */
  needsRehash(passwordHash: string): boolean;
}

export interface VerifyPasswordInput {
  /** The password the user just typed. */
  candidate: string;
  /** The PHC string stored in `accounts.password`. */
  storedHash: string;
}

function readParams() {
  const params = getConfig().auth.argon2;
  return {
    memoryCost: params.memoryCostKiB,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
    hashLength: 32,
  } as const;
}

/**
 * `@node-rs/argon2` implements Argon2 **id** by default (asserted in
 * `tests/unit/passwords.test.ts`, which checks the PHC prefix). The variant is
 * therefore not passed as a library enum value; the recorded parameters are the
 * ones `hash()` actually uses.
 */
export function describeParams(): string {
  const p = readParams();
  return `argon2id v=19 m=${p.memoryCost}KiB t=${p.timeCost} p=${p.parallelism} len=${p.hashLength}`;
}

export function createPasswordHasher(): PasswordHasher {
  const params = readParams();

  return {
    async hash(password) {
      return hash(password, params);
    },
    async verify({ candidate, storedHash }: VerifyPasswordInput) {
      try {
        return await verify(storedHash, candidate);
      } catch {
        // A malformed or foreign hash is a failed login, never a crash.
        return false;
      }
    },
    needsRehash(passwordHash) {
      // The PHC string carries the parameters that produced it.
      const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(passwordHash);
      if (!match) return true;
      const [, memoryCost, timeCost, parallelism] = match;
      return (
        Number(memoryCost) !== params.memoryCost ||
        Number(timeCost) !== params.timeCost ||
        Number(parallelism) !== params.parallelism
      );
    },
  };
}

/** Shared instance: Better Auth needs stable `hash`/`verify` functions. */
export const passwordHasher = createPasswordHasher();

export async function hashPassword(password: string): Promise<string> {
  return passwordHasher.hash(password);
}

export async function verifyPassword(input: VerifyPasswordInput): Promise<boolean> {
  return passwordHasher.verify(input);
}

/**
 * Minimum password policy, enforced in the UI and in the API. The spec does not
 * fix a length; 12 characters with no composition rule is the current choice,
 * recorded in the ADR and covered by tests. Longer is always allowed.
 */
export const MIN_PASSWORD_LENGTH = 12;
export const MAX_PASSWORD_LENGTH = 128;

export function validatePasswordStrength(password: string): string[] {
  const problems: string[] = [];
  if (password.length < MIN_PASSWORD_LENGTH) problems.push(`too_short:${MIN_PASSWORD_LENGTH}`);
  if (password.length > MAX_PASSWORD_LENGTH) problems.push(`too_long:${MAX_PASSWORD_LENGTH}`);
  if (/^\s+|\s+$/.test(password)) problems.push("leading_or_trailing_whitespace");
  return problems;
}
